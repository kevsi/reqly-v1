import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { createHmac } from "node:crypto";
import hookletRoute from "../routes/hooklet.js";
import hookletHooksRoute from "../routes/hooklet-hooks.js";
import db from "../db.js";

// Build a signed Bearer session token (same shape auth.ts expects).
function makeSessionToken(userId: string): string {
  const secret = process.env.AUTH_SIGNING_SECRET!;
  const payload = {
    email: `${userId}@example.com`,
    name: userId,
    provider: "password",
    userId,
    expires: Date.now() + 60_000,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

function buildApp() {
  const app = new Hono();
  app.route("/api/hooks", hookletHooksRoute);
  app.route("/api/hooklet", hookletRoute);
  return app;
}

const USER = "hooklet-user";

const authHeaders = (userId = USER) => ({
  Authorization: `Bearer ${makeSessionToken(userId)}`,
  "Content-Type": "application/json",
});

beforeEach(() => {
  process.env.AUTH_SIGNING_SECRET = "test-secret-do-not-use-in-prod";
  db.exec(
    "DELETE FROM hooklet_devices; DELETE FROM hooklet_events; DELETE FROM hooklet_endpoints; DELETE FROM users;",
  );
  db.prepare("INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)").run(
    USER,
    `${USER}@example.com`,
    "Hooklet User",
    Date.now(),
  );
});

async function createEndpoint(
  app: ReturnType<typeof buildApp>,
  name = "Stripe payments",
  withSecret = false,
) {
  const res = await app.request("/api/hooklet/endpoints", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ name, withSecret }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { endpoint: any };
}

describe("routes/hooklet — auth", () => {
  it("returns 401 without a token", async () => {
    const app = buildApp();
    const res = await app.request("/api/hooklet/endpoints");
    expect(res.status).toBe(401);
  });

  it("rejects endpoints not owned by the user with 404", async () => {
    const app = buildApp();
    const { endpoint } = await createEndpoint(app);
    const res = await app.request(`/api/hooklet/endpoints/${endpoint.id}/notify`, {
      method: "POST",
      headers: authHeaders("other-user"),
      body: JSON.stringify({ notify: false }),
    });
    expect(res.status).toBe(404);
  });
});

describe("routes/hooklet — endpoints", () => {
  it("creates and lists endpoints with camelCase mapping", async () => {
    const app = buildApp();
    const { endpoint } = await createEndpoint(app, "Stripe payments", true);
    expect(endpoint.name).toBe("Stripe payments");
    expect(endpoint.slug).toMatch(/^[0-9a-f]{24}$/);
    expect(endpoint.secret).toMatch(/^[0-9a-f]{24}$/);
    expect(endpoint.notify).toBe(true);
    expect(typeof endpoint.createdAt).toBe("number");

    const list = await app.request("/api/hooklet/endpoints", { headers: authHeaders() });
    const { endpoints } = (await list.json()) as { endpoints: any[] };
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0].id).toBe(endpoint.id);
  });

  it("toggles notify", async () => {
    const app = buildApp();
    const { endpoint } = await createEndpoint(app);
    const res = await app.request(`/api/hooklet/endpoints/${endpoint.id}/notify`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ notify: false }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { notify: boolean };
    expect(body.notify).toBe(false);
  });

  it("deletes an endpoint and its events", async () => {
    const app = buildApp();
    const { endpoint } = await createEndpoint(app);
    await app.request(`/api/hooks/${endpoint.slug}`, {
      method: "POST",
      body: JSON.stringify({ hello: "world" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await app.request(`/api/hooklet/endpoints/${endpoint.id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const eventsLeft = db
      .prepare("SELECT COUNT(*) as n FROM hooklet_events WHERE endpoint_id = ?")
      .get(endpoint.id) as { n: number };
    expect(eventsLeft.n).toBe(0);
  });
});

describe("routes/hooklet — events (ingest)", () => {
  it("ingests a public webhook and lists it", async () => {
    const app = buildApp();
    const { endpoint } = await createEndpoint(app, "Stripe");
    const ingest = await app.request(`/api/hooks/${endpoint.slug}`, {
      method: "POST",
      body: JSON.stringify({ event: "charge.succeeded", amount: 100 }),
      headers: { "Content-Type": "application/json" },
    });
    expect(ingest.status).toBe(200);

    const list = await app.request("/api/hooklet/events", { headers: authHeaders() });
    const { events } = (await list.json()) as { events: any[] };
    expect(events).toHaveLength(1);
    expect(events[0].method).toBe("POST");
    expect(events[0].endpointId).toBe(endpoint.id);
    expect(events[0].body).toContain("charge.succeeded");
    expect(events[0].headers["content-type"]).toContain("application/json");
  });

  it("rejects a webhook with the wrong secret", async () => {
    const app = buildApp();
    const { endpoint } = await createEndpoint(app, "Secured", true);
    const res = await app.request(`/api/hooks/${endpoint.slug}`, {
      method: "POST",
      headers: { "x-webhook-secret": "wrong" },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });

  it("accepts a webhook with the correct secret and redacts it from stored headers", async () => {
    const app = buildApp();
    const { endpoint } = await createEndpoint(app, "Secured", true);
    const res = await app.request(`/api/hooks/${endpoint.slug}`, {
      method: "POST",
      headers: { "x-webhook-secret": endpoint.secret as string, "Content-Type": "text/plain" },
      body: "ping",
    });
    expect(res.status).toBe(200);
    const row = db
      .prepare("SELECT headers FROM hooklet_events WHERE endpoint_id = ?")
      .get(endpoint.id) as { headers: string };
    const parsed = JSON.parse(row.headers) as Record<string, string>;
    expect(parsed["x-webhook-secret"]).toBe("[redacted]");
  });

  it("replays an event", async () => {
    const app = buildApp();
    const { endpoint } = await createEndpoint(app, "Stripe");
    await app.request(`/api/hooks/${endpoint.slug}`, {
      method: "POST",
      body: JSON.stringify({ event: "charge.succeeded" }),
      headers: { "Content-Type": "application/json" },
    });
    const list = await app.request("/api/hooklet/events", { headers: authHeaders() });
    const { events } = (await list.json()) as { events: any[] };
    const replay = await app.request(`/api/hooklet/events/${events[0].id}/replay`, {
      method: "POST",
      headers: authHeaders(),
    });
    expect(replay.status).toBe(200);
    const after = db
      .prepare("SELECT COUNT(*) as n FROM hooklet_events WHERE endpoint_id = ?")
      .get(endpoint.id) as { n: number };
    expect(after.n).toBe(2);
  });

  it("deletes an event", async () => {
    const app = buildApp();
    const { endpoint } = await createEndpoint(app, "Stripe");
    await app.request(`/api/hooks/${endpoint.slug}`, { method: "GET" });
    const list = await app.request("/api/hooklet/events", { headers: authHeaders() });
    const { events } = (await list.json()) as { events: any[] };
    const res = await app.request(`/api/hooklet/events/${events[0].id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const remaining = db
      .prepare("SELECT COUNT(*) as n FROM hooklet_events WHERE endpoint_id = ?")
      .get(endpoint.id) as { n: number };
    expect(remaining.n).toBe(0);
  });
});

describe("routes/hooklet — devices", () => {
  it("registers, lists and unregisters a device", async () => {
    const app = buildApp();
    const token = "ExponentPushToken[test-device-123]";
    const register = await app.request("/api/hooklet/devices", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ expoPushToken: token, platform: "android", deviceName: "Pixel 8" }),
    });
    expect(register.status).toBe(201);

    const list = await app.request("/api/hooklet/devices", { headers: authHeaders() });
    const { devices } = (await list.json()) as { devices: any[] };
    expect(devices).toHaveLength(1);
    expect(devices[0].expoPushToken).toBe(token);
    expect(devices[0].deviceName).toBe("Pixel 8");

    // Re-registering upserts (200, same id).
    const again = await app.request("/api/hooklet/devices", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        expoPushToken: token,
        platform: "android",
        deviceName: "Pixel 8 Pro",
      }),
    });
    expect(again.status).toBe(200);
    const body = (await again.json()) as { id: number };
    expect(body.id).toBe(devices[0].id);

    const unregister = await app.request(
      `/api/hooklet/devices?token=${encodeURIComponent(token)}`,
      {
        method: "DELETE",
        headers: authHeaders(),
      },
    );
    expect(unregister.status).toBe(200);
    const after = db.prepare("SELECT COUNT(*) as n FROM hooklet_devices").get() as { n: number };
    expect(after.n).toBe(0);
  });

  it("returns 0 count for /devices/test when no devices", async () => {
    const app = buildApp();
    const res = await app.request("/api/hooklet/devices/test", {
      method: "POST",
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number };
    expect(body.count).toBe(0);
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import { createHmac } from "node:crypto";
import monitorsRoute from "../routes/monitors.js";
import { runDueMonitors, type MonitorDefinition } from "../monitors-runner.js";
import db from "../db.js";
import type { AuthContext } from "../auth.js";

function makeSessionCookie(
  userId: string,
  overrides: Partial<{ email: string; name: string }> = {},
): string {
  const secret = process.env.AUTH_SIGNING_SECRET!;
  const payload = {
    email: overrides.email ?? `${userId}@example.com`,
    name: overrides.name ?? userId,
    provider: "github",
    userId,
    expires: Date.now() + 60_000,
    ver: 0,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

function buildApp() {
  const app = new Hono<{ Variables: { auth: AuthContext } }>();
  app.route("/monitors", monitorsRoute);
  return app;
}

const USER_A = "user-a";
const USER_B = "user-b";

function validDefinition(): MonitorDefinition {
  return {
    name: "API uptime",
    enabled: true,
    intervalSec: 300,
    checks: { expectedStatus: 200 },
    requests: [
      { id: "r1", name: "Health", method: "GET", url: "https://example.com/health" },
    ],
  };
}

beforeEach(() => {
  process.env.AUTH_SIGNING_SECRET = "test-secret-do-not-use-in-prod";
  db.exec(`
    DELETE FROM monitor_runs;
    DELETE FROM monitors;
    DELETE FROM memberships;
    DELETE FROM workspaces;
    DELETE FROM users;
  `);
  db.prepare("INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)").run(
    USER_A,
    `${USER_A}@x`,
    "A",
    1,
  );
  db.prepare("INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)").run(
    USER_B,
    `${USER_B}@x`,
    "B",
    1,
  );
});

function authHeaders(userId: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    cookie: `auth_session=${makeSessionCookie(userId)}`,
  };
}

describe("routes/monitors", () => {
  it("returns 401 without a session", async () => {
    const app = buildApp();
    const res = await app.request("/monitors");
    expect(res.status).toBe(401);
  });

  it("creates, lists and deletes a monitor", async () => {
    const app = buildApp();
    const headers = authHeaders(USER_A);

    const created = await app.request("/monitors", {
      method: "POST",
      headers,
      body: JSON.stringify(validDefinition()),
    });
    expect(created.status).toBe(201);
    const { monitor } = (await created.json()) as { monitor: { id: string; nextRunAt: number } };
    expect(monitor.id).toMatch(/^mon-/);
    expect(monitor.nextRunAt).toBeGreaterThan(Date.now());

    const list = await app.request("/monitors", { headers });
    const listBody = (await list.json()) as { monitors: Array<{ name: string; enabled: boolean }> };
    expect(listBody.monitors).toHaveLength(1);
    expect(listBody.monitors[0].name).toBe("API uptime");
    expect(listBody.monitors[0].enabled).toBe(true);

    const deleted = await app.request(`/monitors/${monitor.id}`, {
      method: "DELETE",
      headers,
    });
    expect(deleted.status).toBe(200);
  });

  it("rejects an invalid definition", async () => {
    const app = buildApp();
    const definition = { ...validDefinition(), intervalSec: 45 };
    const res = await app.request("/monitors", {
      method: "POST",
      headers: authHeaders(USER_A),
      body: JSON.stringify(definition),
    });
    expect(res.status).toBe(400);
  });

  it("isolates monitors per user (404 on foreign access)", async () => {
    const app = buildApp();
    const created = await app.request("/monitors", {
      method: "POST",
      headers: authHeaders(USER_A),
      body: JSON.stringify(validDefinition()),
    });
    const { monitor } = (await created.json()) as { monitor: { id: string } };

    const foreignRuns = await app.request(`/monitors/${monitor.id}/runs`, {
      headers: authHeaders(USER_B),
    });
    expect(foreignRuns.status).toBe(404);

    const foreignDelete = await app.request(`/monitors/${monitor.id}`, {
      method: "DELETE",
      headers: authHeaders(USER_B),
    });
    expect(foreignDelete.status).toBe(404);
  });

  it("records runs and exposes them to the owner only", async () => {
    const app = buildApp();
    const headers = authHeaders(USER_A);
    const created = await app.request("/monitors", {
      method: "POST",
      headers,
      body: JSON.stringify(validDefinition()),
    });
    const { monitor } = (await created.json()) as { monitor: { id: string } };

    db.prepare(
      `INSERT INTO monitor_runs (monitor_id, status, duration_ms, checks, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(monitor.id, "pass", 42, JSON.stringify([{ requestId: "r1", name: "Health", ok: true }]), Date.now());

    const runs = await app.request(`/monitors/${monitor.id}/runs`, { headers });
    expect(runs.status).toBe(200);
    const body = (await runs.json()) as { runs: Array<{ status: string; durationMs: number }> };
    expect(body.runs).toHaveLength(1);
    expect(body.runs[0].status).toBe("pass");
  });
});

describe("monitors-runner", () => {
  it("executes due monitors, stores the run and updates last_status", async () => {
    // DNS mocké : le garde SSRF doit valider un hôte qui résout vers une
    // IP publique, puis fetch est mocké pour éviter tout appel réseau.
    vi.mock("node:dns/promises", () => ({
      lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
    }));
    const fetchMock = vi.fn(async () =>
      new Response("OK", { status: 200, headers: { "content-type": "text/plain" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const definition = JSON.stringify(validDefinition());
    db.prepare(
      `INSERT INTO monitors (id, user_id, name, enabled, interval_sec, definition, next_run_at, last_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("mon-x", USER_A, "API uptime", 1, 300, definition, Date.now() - 1000, null, 1, 1);

    const executed = await runDueMonitors();
    expect(executed).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const run = db
      .prepare(`SELECT status, checks FROM monitor_runs WHERE monitor_id = 'mon-x'`)
      .get() as { status: string; checks: string };
    expect(run.status).toBe("pass");
    expect(JSON.parse(run.checks)[0].statusCode).toBe(200);

    const row = db.prepare(`SELECT last_status, next_run_at FROM monitors WHERE id = 'mon-x'`).get() as {
      last_status: string;
      next_run_at: number;
    };
    expect(row.last_status).toBe("pass");
    expect(row.next_run_at).toBeGreaterThan(Date.now());

    vi.unstubAllGlobals();
    vi.doUnmock("node:dns/promises");
  });

  it("marks a run as failed when the status code does not match", async () => {
    vi.mock("node:dns/promises", () => ({
      lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    );

    const definition = JSON.stringify(validDefinition());
    db.prepare(
      `INSERT INTO monitors (id, user_id, name, enabled, interval_sec, definition, next_run_at, last_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("mon-y", USER_A, "API uptime", 1, 300, definition, Date.now() - 1000, "pass", 1, 1);

    await runDueMonitors();
    const run = db
      .prepare(`SELECT status FROM monitor_runs WHERE monitor_id = 'mon-y'`)
      .get() as { status: string };
    expect(run.status).toBe("fail");

    vi.unstubAllGlobals();
    vi.doUnmock("node:dns/promises");
  });

  it("never executes a monitor targeting a private address", async () => {
    // Garde SSRF réel (pas de mock DNS) : localhost est refusé avant fetch.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("fetch must not be called");
      }),
    );

    const definition = JSON.stringify({
      ...validDefinition(),
      requests: [{ id: "r1", name: "Local", method: "GET", url: "http://localhost:9999/x" }],
    });
    db.prepare(
      `INSERT INTO monitors (id, user_id, name, enabled, interval_sec, definition, next_run_at, last_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("mon-z", USER_A, "Local probe", 1, 300, definition, Date.now() - 1000, null, 1, 1);

    await runDueMonitors();
    const run = db
      .prepare(`SELECT status, checks FROM monitor_runs WHERE monitor_id = 'mon-z'`)
      .get() as { status: string; checks: string };
    expect(run.status).toBe("fail");
    const checks = JSON.parse(run.checks) as Array<{ error?: string }>;
    expect(checks[0].error).toContain("non autorisé");

    vi.unstubAllGlobals();
  });
});

import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import db from "../db.js";
import { requireAuth, type AuthContext } from "../auth.js";
import { safeParseJson } from "../validation.js";
import { sendPushToUser } from "../push.js";

// Hooklet: personal webhook inbox.
// Protected routes mounted at /api/hooklet (Authorization: Bearer <session>).
// The public ingest endpoint lives in ./hooklet-hooks.ts (/api/hooks/:slug).

const hooklet = new Hono<{ Variables: { auth: AuthContext } }>();
hooklet.use("*", requireAuth);

// ── Row → API mappers (snake_case DB → camelCase JSON) ──────────────────────

type EndpointRow = {
  id: number;
  user_id: string;
  slug: string;
  name: string;
  secret: string | null;
  notify: number;
  created_at: number;
};

function mapEndpoint(r: EndpointRow) {
  return {
    id: r.id,
    userId: r.user_id,
    slug: r.slug,
    name: r.name,
    secret: r.secret,
    notify: r.notify === 1,
    createdAt: r.created_at,
  };
}

type EventRow = {
  id: number;
  user_id: string;
  endpoint_id: number;
  method: string;
  headers: string;
  query: string | null;
  body: string | null;
  content_type: string | null;
  source_ip: string | null;
  replayed_from_id: number | null;
  created_at: number;
};

function mapEvent(r: EventRow) {
  let headers: Record<string, string> = {};
  try {
    headers = JSON.parse(r.headers);
  } catch {
    headers = {};
  }
  return {
    id: r.id,
    userId: r.user_id,
    endpointId: r.endpoint_id,
    method: r.method,
    headers,
    query: r.query,
    body: r.body,
    contentType: r.content_type,
    sourceIp: r.source_ip,
    replayedFromId: r.replayed_from_id,
    createdAt: r.created_at,
  };
}

type DeviceRow = {
  id: number;
  user_id: string;
  expo_push_token: string;
  platform: string | null;
  device_name: string | null;
  created_at: number;
  last_seen_at: number;
};

function mapDevice(r: DeviceRow) {
  return {
    id: r.id,
    userId: r.user_id,
    expoPushToken: r.expo_push_token,
    platform: r.platform,
    deviceName: r.device_name,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
  };
}

function randomSlug(): string {
  // URL-safe, unguessable slug (24 hex chars).
  return randomBytes(12).toString("hex");
}

function getOwnedEndpointOr404(userId: string, id: number) {
  return db
    .prepare("SELECT * FROM hooklet_endpoints WHERE id = ? AND user_id = ?")
    .get(id, userId) as EndpointRow | undefined;
}

// ── Endpoints ───────────────────────────────────────────────────────────────

hooklet.get("/endpoints", (c) => {
  const auth = c.get("auth") as AuthContext;
  const rows = db
    .prepare("SELECT * FROM hooklet_endpoints WHERE user_id = ? ORDER BY created_at DESC")
    .all(auth.userId) as EndpointRow[];
  return c.json({ endpoints: rows.map(mapEndpoint) });
});

const CreateEndpointSchema = z.object({
  name: z.string().max(120).optional(),
  withSecret: z.boolean().optional(),
});

hooklet.post("/endpoints", async (c) => {
  const auth = c.get("auth") as AuthContext;
  const parsed = await safeParseJson(c, CreateEndpointSchema);
  if (!parsed.success) return parsed.response;
  const name = parsed.data.name?.trim() || "New endpoint";
  const secret = parsed.data.withSecret ? randomSlug() : null;
  const now = Date.now();
  const info = db
    .prepare(
      `INSERT INTO hooklet_endpoints (user_id, slug, name, secret, notify, created_at)
       VALUES (?, ?, ?, ?, 1, ?)`,
    )
    .run(auth.userId, randomSlug(), name, secret, now);
  const row = db
    .prepare("SELECT * FROM hooklet_endpoints WHERE id = ?")
    .get(info.lastInsertRowid) as EndpointRow;
  return c.json({ endpoint: mapEndpoint(row) }, 201);
});

const ToggleNotifySchema = z.object({ notify: z.boolean() });

hooklet.post("/endpoints/:id/notify", async (c) => {
  const auth = c.get("auth") as AuthContext;
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "Invalid id" }, 400);
  const parsed = await safeParseJson(c, ToggleNotifySchema);
  if (!parsed.success) return parsed.response;
  const owned = getOwnedEndpointOr404(auth.userId, id);
  if (!owned) return c.json({ error: "Endpoint not found" }, 404);
  db.prepare("UPDATE hooklet_endpoints SET notify = ? WHERE id = ?").run(
    parsed.data.notify ? 1 : 0,
    id,
  );
  return c.json({ success: true, notify: parsed.data.notify });
});

hooklet.delete("/endpoints/:id", (c) => {
  const auth = c.get("auth") as AuthContext;
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "Invalid id" }, 400);
  const owned = getOwnedEndpointOr404(auth.userId, id);
  if (!owned) return c.json({ error: "Endpoint not found" }, 404);
  db.prepare("DELETE FROM hooklet_events WHERE endpoint_id = ? AND user_id = ?").run(
    id,
    auth.userId,
  );
  db.prepare("DELETE FROM hooklet_endpoints WHERE id = ? AND user_id = ?").run(id, auth.userId);
  return c.json({ success: true });
});

// ── Events ──────────────────────────────────────────────────────────────────

hooklet.get("/events", (c) => {
  const auth = c.get("auth") as AuthContext;
  const rawEndpointId = c.req.query("endpointId");
  const endpointIdNum = Number(rawEndpointId);
  const endpointId =
    rawEndpointId !== undefined &&
    rawEndpointId !== null &&
    rawEndpointId.trim() !== "" &&
    Number.isInteger(endpointIdNum) &&
    endpointIdNum > 0
      ? endpointIdNum
      : null;
  const rawLimit = Number(c.req.query("limit") ?? 100);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 200) : 100;

  const rows = endpointId
    ? (db
        .prepare(
          "SELECT * FROM hooklet_events WHERE user_id = ? AND endpoint_id = ? ORDER BY created_at DESC LIMIT ?",
        )
        .all(auth.userId, endpointId, limit) as EventRow[])
    : (db
        .prepare("SELECT * FROM hooklet_events WHERE user_id = ? ORDER BY created_at DESC LIMIT ?")
        .all(auth.userId, limit) as EventRow[]);

  return c.json({ events: rows.map(mapEvent) });
});

hooklet.delete("/events/:id", (c) => {
  const auth = c.get("auth") as AuthContext;
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "Invalid id" }, 400);
  const info = db
    .prepare("DELETE FROM hooklet_events WHERE id = ? AND user_id = ?")
    .run(id, auth.userId);
  if (info.changes === 0) return c.json({ error: "Event not found" }, 404);
  return c.json({ success: true });
});

/**
 * Replay an event: re-insert it as a new event on the same endpoint and fire a
 * fresh push notification, exactly as if it had just arrived.
 */
hooklet.post("/events/:id/replay", async (c) => {
  const auth = c.get("auth") as AuthContext;
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "Invalid id" }, 400);
  const original = db
    .prepare("SELECT * FROM hooklet_events WHERE id = ? AND user_id = ?")
    .get(id, auth.userId) as EventRow | undefined;
  if (!original) return c.json({ error: "Event not found" }, 404);

  const endpoint = db
    .prepare("SELECT * FROM hooklet_endpoints WHERE id = ? AND user_id = ?")
    .get(original.endpoint_id, auth.userId) as EndpointRow | undefined;

  const info = db
    .prepare(
      `INSERT INTO hooklet_events
        (user_id, endpoint_id, method, headers, query, body, content_type, source_ip, replayed_from_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      auth.userId,
      original.endpoint_id,
      original.method,
      original.headers,
      original.query,
      original.body,
      original.content_type,
      original.source_ip,
      original.id,
      Date.now(),
    );
  const newId = Number(info.lastInsertRowid);

  if (endpoint?.notify === 1) {
    await sendPushToUser(auth.userId, {
      title: `Replayed: ${endpoint.name}`,
      body: `${original.method} event replayed`,
      data: { eventId: newId, endpointId: original.endpoint_id },
    });
  }

  return c.json({ success: true, id: newId });
});

// ── Devices ─────────────────────────────────────────────────────────────────

hooklet.get("/devices", (c) => {
  const auth = c.get("auth") as AuthContext;
  const rows = db
    .prepare("SELECT * FROM hooklet_devices WHERE user_id = ? ORDER BY last_seen_at DESC")
    .all(auth.userId) as DeviceRow[];
  return c.json({ devices: rows.map(mapDevice) });
});

const RegisterDeviceSchema = z.object({
  expoPushToken: z.string().min(1),
  platform: z.string().max(40).optional(),
  deviceName: z.string().max(120).optional(),
});

hooklet.post("/devices", async (c) => {
  const auth = c.get("auth") as AuthContext;
  const parsed = await safeParseJson(c, RegisterDeviceSchema);
  if (!parsed.success) return parsed.response;
  const { expoPushToken, platform, deviceName } = parsed.data;

  const existing = db
    .prepare("SELECT id, platform, device_name FROM hooklet_devices WHERE expo_push_token = ?")
    .get(expoPushToken) as
    { id: number; platform: string | null; device_name: string | null } | undefined;

  if (existing) {
    db.prepare(
      "UPDATE hooklet_devices SET user_id = ?, platform = ?, device_name = ?, last_seen_at = ? WHERE id = ?",
    ).run(
      auth.userId,
      platform ?? existing.platform,
      deviceName ?? existing.device_name,
      Date.now(),
      existing.id,
    );
    return c.json({ ok: true, id: existing.id });
  }

  const info = db
    .prepare(
      `INSERT INTO hooklet_devices (user_id, expo_push_token, platform, device_name, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(auth.userId, expoPushToken, platform ?? null, deviceName ?? null, Date.now(), Date.now());
  return c.json({ ok: true, id: Number(info.lastInsertRowid) }, 201);
});

hooklet.delete("/devices", (c) => {
  const auth = c.get("auth") as AuthContext;
  const token = c.req.query("token");
  if (!token) return c.json({ error: "token is required" }, 400);
  db.prepare("DELETE FROM hooklet_devices WHERE expo_push_token = ? AND user_id = ?").run(
    token,
    auth.userId,
  );
  return c.json({ ok: true });
});

/**
 * Send a test push to all of the current user's devices.
 */
hooklet.post("/devices/test", async (c) => {
  const auth = c.get("auth") as AuthContext;
  const count = await sendPushToUser(auth.userId, {
    title: "Test notification",
    body: "Your webhook notifications are working.",
    data: { test: true },
  });
  return c.json({ count });
});

export default hooklet;

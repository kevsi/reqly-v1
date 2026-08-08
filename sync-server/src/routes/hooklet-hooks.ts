import { Hono, type Context } from "hono";
import { timingSafeEqual } from "node:crypto";
import db from "../db.js";
import { sendPushToUser } from "../push.js";

// Cap the number of stored events per endpoint so an attacker who learns a
// slug (or a firehose of events) cannot grow the single SQLite DB unboundedly.
const MAX_EVENTS_PER_ENDPOINT = 200;
// Cap each stored body: 200 × 64 KB ≈ 13 MB per endpoint instead of
// 200 × 5 MB. The incoming request is capped at 5 MB by the global bodyLimit.
const MAX_STORED_BODY_BYTES = 64 * 1024;

// Public webhook ingest endpoint: /api/hooks/:slug
// External services POST/GET/PUT/PATCH/DELETE here. It must NOT require a
// session. Authorization, when configured, is via a per-endpoint secret.

const hooks = new Hono();

type EndpointRow = {
  id: number;
  user_id: string;
  slug: string;
  name: string;
  secret: string | null;
  notify: number;
};

async function handle(c: Context, slug: string) {
  const endpoint = db.prepare("SELECT * FROM hooklet_endpoints WHERE slug = ?").get(slug) as
    EndpointRow | undefined;

  if (!endpoint) {
    return c.json({ error: "Endpoint not found" }, 404);
  }

  // Optional shared-secret check (constant-time compare).
  if (endpoint.secret) {
    const url = new URL(c.req.url);
    const provided = c.req.header("x-webhook-secret") ?? url.searchParams.get("secret");
    if (!provided || provided.length !== endpoint.secret.length) {
      return c.json({ error: "Invalid secret" }, 401);
    }
    const a = Buffer.from(provided);
    const b = Buffer.from(endpoint.secret);
    if (!timingSafeEqual(a, b)) {
      return c.json({ error: "Invalid secret" }, 401);
    }
  }

  const url = new URL(c.req.url);
  // Persist the query string without the `secret` param so the credential is
  // not stored in plaintext alongside the event.
  const storedParams = new URLSearchParams(url.search);
  storedParams.delete("secret");
  const storedQuery = storedParams.toString() || null;
  const contentType = c.req.header("content-type") ?? null;
  let body: string | null = null;
  try {
    body = (await c.req.text()) || null;
    if (body && body.length > MAX_STORED_BODY_BYTES) {
      body = body.slice(0, MAX_STORED_BODY_BYTES);
    }
  } catch {
    body = null;
  }

  // Redact the secret header so it isn't persisted in plaintext.
  const headersObj: Record<string, string> = {};
  c.req.raw.headers.forEach((value, key) => {
    headersObj[key] = key.toLowerCase() === "x-webhook-secret" ? "[redacted]" : value;
  });

  const sourceIp =
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? null;

  const info = db
    .prepare(
      `INSERT INTO hooklet_events
        (user_id, endpoint_id, method, headers, query, body, content_type, source_ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      endpoint.user_id,
      endpoint.id,
      c.req.method,
      JSON.stringify(headersObj),
      storedQuery,
      body,
      contentType,
      sourceIp,
      Date.now(),
    );
  const newId = Number(info.lastInsertRowid);

  // Prune the oldest events for this endpoint so storage stays bounded.
  db.prepare(
    `DELETE FROM hooklet_events
     WHERE endpoint_id = ? AND id <= (
       SELECT id FROM hooklet_events WHERE endpoint_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?
     )`,
  ).run(endpoint.id, endpoint.id, MAX_EVENTS_PER_ENDPOINT);

  if (endpoint.notify === 1) {
    await sendPushToUser(endpoint.user_id, {
      title: `Webhook: ${endpoint.name}`,
      body: summarize(c.req.method, body, contentType),
      data: { eventId: newId, endpointId: endpoint.id, slug },
    });
  }

  return c.json({ ok: true, id: newId }, 200);
}

function summarize(method: string, body: string | null, contentType: string | null): string {
  if (!body) return `${method} request (no body)`;
  if (contentType?.includes("application/json")) {
    try {
      const parsed = JSON.parse(body);
      const keys = Object.keys(parsed);
      if (keys.length) return `${method} · ${keys.slice(0, 4).join(", ")}`;
    } catch {
      // fall through
    }
  }
  const preview = body.replace(/\s+/g, " ").trim().slice(0, 80);
  return `${method} · ${preview}`;
}

hooks.all("/:slug", async (c) => {
  const slug = c.req.param("slug");
  return handle(c, slug);
});

export default hooks;

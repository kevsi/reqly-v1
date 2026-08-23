import { Hono } from "hono";
import { timingSafeEqual } from "node:crypto";
import db from "../db.js";

/**
 * Server-to-server admin API for the reqly-admin dashboard.
 *
 * Auth model: a single shared secret (ADMIN_TOKEN env, same pattern as
 * reqly-monitor). Fail-closed when unset. This surface is intentionally
 * separate from user sessions: an admin is an operator, not a workspace user.
 */

function adminToken(): string {
  return process.env.ADMIN_TOKEN || "";
}

export function requireAdminToken(): (
  c: {
    req: { header: (n: string) => string | undefined };
    json: (b: unknown, s: number) => Response;
  },
  next: () => Promise<void>,
) => Promise<Response | void> {
  return async (c, next) => {
    const provided = c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!adminToken() || !provided) return c.json({ error: "Unauthorized" }, 401);
    const a = Buffer.from(provided, "utf-8");
    const b = Buffer.from(adminToken(), "utf-8");
    const ok = a.length === b.length && timingSafeEqual(a, b);
    if (!ok) return c.json({ error: "Unauthorized" }, 401);
    await next();
  };
}

const admin = new Hono();
admin.use("*", requireAdminToken());

/** Clamp + validate pagination params (?limit=1..100, ?offset>=0). */
function page(c: { req: { query: (n: string) => string | undefined } }): {
  limit: number;
  offset: number;
} {
  const limitRaw = c.req.query("limit") ?? "50";
  const offsetRaw = c.req.query("offset") ?? "0";
  let limit = /^\d+$/.test(limitRaw) ? Number(limitRaw) : 50;
  limit = Math.min(Math.max(limit, 1), 100);
  const offset = /^\d+$/.test(offsetRaw) ? Number(offsetRaw) : 0;
  return { limit, offset };
}

// ── GET /stats ────────────────────────────────────────────────────────────
admin.get("/stats", (c) => {
  const count = (sql: string, ...params: unknown[]): number =>
    Number((db.prepare(sql).get(...params) as { n: number | bigint }).n ?? 0);

  return c.json({
    users: count(`SELECT COUNT(*) AS n FROM users`),
    verifiedUsers: count(`SELECT COUNT(*) AS n FROM users WHERE verified = 1`),
    oauthUsers: count(`SELECT COUNT(*) AS n FROM users WHERE password_hash IS NULL`),
    disabledUsers: count(`SELECT COUNT(*) AS n FROM users WHERE disabled = 1`),
    workspaces: count(`SELECT COUNT(*) AS n FROM workspaces`),
    memberships: count(`SELECT COUNT(*) AS n FROM memberships`),
    pendingInvitations: count(
      `SELECT COUNT(*) AS n FROM invitations WHERE used = 0 AND expires_at > ?`,
      Date.now(),
    ),
    collections: count(`SELECT COUNT(*) AS n FROM collections WHERE deleted = 0`),
    generatedAt: Date.now(),
  });
});

// ── GET /users?query=&limit=&offset= ──────────────────────────────────────
admin.get("/users", (c) => {
  const { limit, offset } = page(c);
  const query = (c.req.query("query") ?? "").trim();

  const where = query ? `WHERE u.email LIKE ? OR u.name LIKE ?` : ``;
  const like = `%${query}%`;
  const rows = (
    db
      .prepare(
        `SELECT u.id, u.email, u.name, u.verified, u.created_at,
                u.disabled, u.locked_until, u.token_version,
                (u.password_hash IS NULL) AS is_oauth,
                (SELECT COUNT(*) FROM memberships m WHERE m.user_id = u.id) AS workspace_count,
                (SELECT MAX(a.created_at) FROM activity_log a WHERE a.actor_id = u.id) AS last_activity_at
         FROM users u ${where}
         ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...(query ? [like, like] : []), limit, offset) as Array<Record<string, unknown>>
  ).map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    verified: !!r.verified,
    createdAt: r.created_at,
    disabled: !!r.disabled,
    lockedUntil: r.locked_until ?? null,
    provider: r.is_oauth ? "oauth" : "password",
    workspaceCount: r.workspace_count,
    lastActivityAt: r.last_activity_at ?? null,
  }));

  const totalRow = db
    .prepare(`SELECT COUNT(*) AS n FROM users u ${where}`)
    .get(...(query ? [like, like] : [])) as {
    n: number;
  };

  return c.json({ users: rows, total: Number(totalRow.n), limit, offset });
});

// ── GET /users/:id — detail + memberships ────────────────────────────────
admin.get("/users/:id", (c) => {
  const id = c.req.param("id");
  const user = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.verified, u.created_at, u.disabled, u.locked_until,
              (u.password_hash IS NULL) AS is_oauth
       FROM users u WHERE u.id = ?`,
    )
    .get(id) as Record<string, unknown> | undefined;
  if (!user) return c.json({ error: "Not found" }, 404);

  const memberships = db
    .prepare(
      `SELECT m.workspace_id, w.name AS workspace_name, m.role, m.created_at
       FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
       WHERE m.user_id = ? ORDER BY m.created_at DESC`,
    )
    .all(id);

  return c.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      verified: !!user.verified,
      createdAt: user.created_at,
      disabled: !!user.disabled,
      lockedUntil: user.locked_until ?? null,
      provider: user.is_oauth ? "oauth" : "password",
    },
    memberships,
  });
});

// ── POST /users/:id/disable — soft ban + kill all sessions ───────────────
admin.post("/users/:id/disable", (c) => {
  const id = c.req.param("id");
  const res = db
    .prepare(`UPDATE users SET disabled = 1, token_version = token_version + 1 WHERE id = ?`)
    .run(id);
  if (res.changes === 0) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// ── POST /users/:id/enable ────────────────────────────────────────────────
admin.post("/users/:id/enable", (c) => {
  const id = c.req.param("id");
  const res = db.prepare(`UPDATE users SET disabled = 0 WHERE id = ?`).run(id);
  if (res.changes === 0) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// ── POST /users/:id/revoke-sessions ──────────────────────────────────────
admin.post("/users/:id/revoke-sessions", (c) => {
  const id = c.req.param("id");
  const exists = db.prepare(`SELECT 1 FROM users WHERE id = ?`).get(id);
  if (!exists) return c.json({ error: "Not found" }, 404);
  db.prepare(`UPDATE users SET token_version = token_version + 1 WHERE id = ?`).run(id);
  return c.json({ ok: true });
});

// ── GET /workspaces?limit=&offset= ───────────────────────────────────────
admin.get("/workspaces", (c) => {
  const { limit, offset } = page(c);
  const rows = db
    .prepare(
      `SELECT w.id, w.name, w.created_at, w.updated_at,
              ou.email AS owner_email,
              (SELECT COUNT(*) FROM memberships m WHERE m.workspace_id = w.id) AS member_count,
              (SELECT COUNT(*) FROM collections col WHERE col.workspace_id = w.id AND col.deleted = 0) AS collection_count
       FROM workspaces w LEFT JOIN users ou ON ou.id = w.owner_id
       ORDER BY w.created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(limit, offset) as Array<Record<string, unknown>>;
  const total = Number(
    (db.prepare(`SELECT COUNT(*) AS n FROM workspaces`).get() as { n: number }).n,
  );
  return c.json({
    workspaces: rows.map((r) => ({
      id: r.id,
      name: r.name,
      ownerEmail: r.owner_email,
      memberCount: r.member_count,
      collectionCount: r.collection_count,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
    total,
    limit,
    offset,
  });
});

// ── GET /activity?limit=&offset= ─────────────────────────────────────────
admin.get("/activity", (c) => {
  const { limit, offset } = page(c);
  const rows = db
    .prepare(
      `SELECT a.id, a.action, a.entity_type, a.entity_id, a.created_at,
               u.email AS actor_email, w.name AS workspace_name
        FROM activity_log a
        LEFT JOIN users u ON u.id = a.actor_id
        LEFT JOIN workspaces w ON w.id = a.workspace_id
        ORDER BY a.id DESC LIMIT ? OFFSET ?`,
    )
    .all(limit, offset);
  return c.json({
    activity: rows.map((r) => ({
      id: (r as { id: number }).id,
      action: (r as { action: string }).action,
      entityType: (r as { entity_type: string | null }).entity_type,
      entityId: (r as { entity_id: string | null }).entity_id,
      actorEmail: (r as { actor_email: string | null }).actor_email,
      workspaceName: (r as { workspace_name: string | null }).workspace_name,
      createdAt: (r as { created_at: number }).created_at,
    })),
  });
});

export default admin;

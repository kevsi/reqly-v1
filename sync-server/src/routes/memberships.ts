import { Hono } from "hono";
import { z } from "zod";
import db from "../db.js";
import { requireAuth, type AuthContext } from "../auth.js";
import { safeParseJson } from "../validation.js";
import { logActivity } from "../activity.js";

const memberships = new Hono<{ Variables: { auth: AuthContext } }>();
memberships.use("*", requireAuth);

const JoinSchema = z.object({ token: z.string() });

memberships.post("/", async (c) => {
  const auth = c.get("auth") as AuthContext;
  const parsed = await safeParseJson(c, JoinSchema);
  if (!parsed.success) return parsed.response;
  const body = parsed.data;

  const now = Date.now();
  // Ensure the user row exists (OAuth sessions may not have created one yet).
  db.prepare(
    `INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name`,
  ).run(auth.userId, auth.email, auth.name, now);

  // Spec §6: invitation tokens are SINGLE-USE. Consumption happens inside a
  // transaction guarded by a conditional UPDATE (used = 0 → 1), so concurrent
  // joins with the same token cannot both succeed.
  let response: { status: 200 | 400; body: Record<string, unknown> };

  const tx = db.transaction(() => {
    const invite = db
      .prepare(`SELECT workspace_id, role, expires_at, used FROM invitations WHERE token = ?`)
      .get(body.token) as
      { workspace_id: string; role: string; expires_at: number; used: number } | undefined;
    if (!invite) {
      response = { status: 400, body: { error: "Invalid or expired token" } };
      return;
    }
    if (invite.expires_at < Date.now()) {
      response = { status: 400, body: { error: "Token expired" } };
      return;
    }
    if (invite.used) {
      response = {
        status: 400,
        body: { error: "Cette invitation a déjà été utilisée. Demandez-en une nouvelle." },
      };
      return;
    }

    const consumed = db
      .prepare(`UPDATE invitations SET used = 1 WHERE token = ? AND used = 0`)
      .run(body.token);
    if (consumed.changes === 0) {
      response = {
        status: 400,
        body: { error: "Cette invitation a déjà été utilisée. Demandez-en une nouvelle." },
      };
      return;
    }

    db.prepare(
      `INSERT OR IGNORE INTO memberships (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)`,
    ).run(invite.workspace_id, auth.userId, invite.role, now);

    logActivity(invite.workspace_id, auth.userId, "member.joined", "membership", auth.userId);

    const workspace = db
      .prepare(
        `SELECT id, name, owner_id as ownerId, created_at as createdAt, updated_at as updatedAt FROM workspaces WHERE id = ?`,
      )
      .get(invite.workspace_id);

    response = { status: 200, body: { workspace, role: invite.role } };
  });
  tx();

  return c.json(response!.body, response!.status);
});

// List all memberships for the authenticated user (which workspaces they belong to)
memberships.get("/", (c) => {
  const auth = c.get("auth") as AuthContext;
  const rows = db
    .prepare(
      `
      SELECT w.id, w.name, m.role, m.created_at as joinedAt
      FROM memberships m
      JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.user_id = ?
      ORDER BY w.updated_at DESC
    `,
    )
    .all(auth.userId) as Array<{ id: string; name: string; role: string; joinedAt: number }>;
  return c.json({ memberships: rows });
});

export default memberships;

import { Hono } from "hono";
import { z } from "zod";
import db from "../db.js";
import { requireAuth, type AuthContext } from "../auth.js";
import { safeParseJson } from "../validation.js";

const memberships = new Hono<{ Variables: { auth: AuthContext } }>();
memberships.use("*", requireAuth);

const JoinSchema = z.object({ token: z.string() });

memberships.post("/", async (c) => {
  const auth = c.get("auth") as AuthContext;
  const parsed = await safeParseJson(c, JoinSchema);
  if (!parsed.success) return parsed.response;
  const body = parsed.data;

  const invite = db
    .prepare(`SELECT workspace_id, role, expires_at FROM invitations WHERE token = ?`)
    .get(body.token) as { workspace_id: string; role: string; expires_at: number } | undefined;
  if (!invite) return c.json({ error: "Invalid or expired token" }, 400);
  if (invite.expires_at < Date.now()) return c.json({ error: "Token expired" }, 400);

  const now = Date.now();
  db.prepare(
    `INSERT OR IGNORE INTO memberships (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)`,
  ).run(invite.workspace_id, auth.userId, invite.role, now);

  const workspace = db
    .prepare(
      `SELECT id, name, owner_id as ownerId, created_at as createdAt, updated_at as updatedAt FROM workspaces WHERE id = ?`,
    )
    .get(invite.workspace_id);

  return c.json({ workspace, role: invite.role });
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

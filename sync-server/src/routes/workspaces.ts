import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import db from "../db.js";
import { requireAuth, type AuthContext } from "../auth.js";
import { safeParseJson } from "../validation.js";

const workspaces = new Hono<{ Variables: { auth: AuthContext } }>();
workspaces.use("*", requireAuth);

const CreateSchema = z.object({ name: z.string().min(1).max(100) });

workspaces.post("/", async (c) => {
  const auth = c.get("auth") as AuthContext;
  const parsed = await safeParseJson(c, CreateSchema);
  if (!parsed.success) return parsed.response;
  const body = parsed.data;
  const id = `ws-${randomUUID()}`;
  const now = Date.now();

  db.prepare(
    `INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name`,
  ).run(auth.userId, auth.email, auth.name, now);

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO workspaces (id, name, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    ).run(id, body.name, auth.userId, now, now);
    db.prepare(
      `INSERT INTO memberships (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)`,
    ).run(id, auth.userId, "owner", now);
  });
  tx();

  return c.json({
    workspace: { id, name: body.name, ownerId: auth.userId, createdAt: now, updatedAt: now },
  });
});

workspaces.get("/", (c) => {
  const auth = c.get("auth") as AuthContext;
  const rows = db
    .prepare(
      `
    SELECT w.id, w.name, w.owner_id as ownerId, w.created_at as createdAt, w.updated_at as updatedAt, m.role
    FROM workspaces w
    JOIN memberships m ON m.workspace_id = w.id
    WHERE m.user_id = ?
    ORDER BY w.updated_at DESC
  `,
    )
    .all(auth.userId) as any[];
  return c.json({ workspaces: rows });
});

const UpdateSchema = z.object({ name: z.string().min(1).max(100) });

workspaces.put("/:id", async (c) => {
  const auth = c.get("auth") as AuthContext;
  const id = c.req.param("id");

  const workspace = db.prepare(`SELECT owner_id FROM workspaces WHERE id = ?`).get(id) as
    { owner_id: string } | undefined;
  if (!workspace) return c.json({ error: "Workspace not found" }, 404);
  if (workspace.owner_id !== auth.userId)
    return c.json({ error: "Only the owner can rename this workspace" }, 403);

  const parsed = await safeParseJson(c, UpdateSchema);
  if (!parsed.success) return parsed.response;

  const now = Date.now();
  db.prepare(`UPDATE workspaces SET name = ?, updated_at = ? WHERE id = ?`).run(
    parsed.data.name,
    now,
    id,
  );

  return c.json({ success: true, updatedAt: now });
});

workspaces.post("/:id/invitations", (c) => {
  const auth = c.get("auth") as AuthContext;
  const id = c.req.param("id");
  const membership = db
    .prepare(`SELECT role FROM memberships WHERE workspace_id = ? AND user_id = ?`)
    .get(id, auth.userId) as { role: string } | undefined;
  if (!membership || membership.role !== "owner") {
    return c.json({ error: "Only owner can invite" }, 403);
  }
  const token = `inv-${randomUUID()}`;
  const now = Date.now();
  const expiresAt = now + 7 * 24 * 60 * 60 * 1000;
  db.prepare(
    `INSERT INTO invitations (token, workspace_id, role, created_at, expires_at, created_by) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(token, id, "editor", now, expiresAt, auth.userId);
  return c.json({ token, expiresAt, role: "editor" });
});

workspaces.get("/:id/members", (c) => {
  const auth = c.get("auth") as AuthContext;
  const id = c.req.param("id");

  // Verify access: must be a member of this workspace
  const ownMembership = db
    .prepare(`SELECT role FROM memberships WHERE workspace_id = ? AND user_id = ?`)
    .get(id, auth.userId) as { role: string } | undefined;
  if (!ownMembership) {
    return c.json({ error: "Not a member of this workspace" }, 403);
  }

  const rows = db
    .prepare(
      `
      SELECT u.id, u.name, u.email, m.role, m.created_at as joinedAt
      FROM memberships m
      JOIN users u ON u.id = m.user_id
      WHERE m.workspace_id = ?
      ORDER BY m.created_at ASC
      `,
    )
    .all(id) as Array<{ id: string; name: string; email: string; role: string; joinedAt: number }>;

  return c.json({ members: rows });
});

workspaces.delete("/:id", (c) => {
  const auth = c.get("auth") as AuthContext;
  const id = c.req.param("id");

  const workspace = db.prepare(`SELECT owner_id FROM workspaces WHERE id = ?`).get(id) as
    { owner_id: string } | undefined;
  if (!workspace) {
    return c.json({ error: "Workspace not found" }, 404);
  }
  if (workspace.owner_id !== auth.userId) {
    return c.json({ error: "Only the owner can delete this workspace" }, 403);
  }

  const tx = db.transaction(() => {
    // Cascade-delete child data before the workspace. The foreign keys on
    // collections/environments/folders use the SQLite default (NO ACTION) with
    // `foreign_keys = ON` (see db.ts), so deleting the workspace first would
    // raise a constraint error whenever it still holds collections — and would
    // otherwise leave orphaned rows. Order: folders → environments →
    // collections → memberships → invitations → workspace.
    db.prepare(
      `DELETE FROM folders WHERE collection_id IN (SELECT id FROM collections WHERE workspace_id = ?)`,
    ).run(id);
    db.prepare(`DELETE FROM environments WHERE workspace_id = ?`).run(id);
    db.prepare(`DELETE FROM collections WHERE workspace_id = ?`).run(id);
    db.prepare(`DELETE FROM memberships WHERE workspace_id = ?`).run(id);
    db.prepare(`DELETE FROM invitations WHERE workspace_id = ?`).run(id);
    db.prepare(`DELETE FROM workspaces WHERE id = ?`).run(id);
  });
  tx();

  return c.json({ success: true });
});

export default workspaces;

import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import db from "../db.js";
import { requireAuth, type AuthContext } from "../auth.js";
import { safeParseJson } from "../validation.js";
import { logActivity, getActivity } from "../activity.js";

const workspaces = new Hono<{ Variables: { auth: AuthContext } }>();
workspaces.use("*", requireAuth);

interface WorkspaceRow {
  id: string;
  name: string;
  ownerId: string;
  createdAt: number;
  updatedAt: number;
  role: string;
}

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
    .all(auth.userId) as WorkspaceRow[];
  return c.json({ workspaces: rows });
});

const UpdateSchema = z.object({ name: z.string().min(1).max(100) });

const ChangeRoleSchema = z.object({
  role: z.enum(["editor", "viewer"]),
});

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

const InviteSchema = z.object({
  // Spec §4.1: the owner picks the role at invitation time. `owner` is never
  // grantable via invitation — ownership changes only through an explicit
  // transfer flow.
  role: z.enum(["editor", "viewer"]).default("editor"),
});

// Anti-spam (spec §6): cap invitations created per user per rolling hour.
// In-memory is fine on this single-instance server (same pattern as the auth
// routes' resendCooldowns).
const INVITE_MAX_PER_HOUR = 10;
const inviteTimestamps = new Map<string, number[]>();

workspaces.post("/:id/invitations", async (c) => {
  const auth = c.get("auth") as AuthContext;
  const id = c.req.param("id");
  const membership = db
    .prepare(`SELECT role FROM memberships WHERE workspace_id = ? AND user_id = ?`)
    .get(id, auth.userId) as { role: string } | undefined;
  if (!membership || membership.role !== "owner") {
    return c.json({ error: "Only owner can invite" }, 403);
  }

  const now = Date.now();
  const stamps = (inviteTimestamps.get(auth.userId) ?? []).filter((t) => now - t < 3_600_000);
  if (stamps.length >= INVITE_MAX_PER_HOUR) {
    return c.json({ error: "Trop d'invitations créées récemment. Réessayez plus tard." }, 429);
  }
  stamps.push(now);
  inviteTimestamps.set(auth.userId, stamps);

  // Role is optional: legacy clients send `{}` or nothing → default editor.
  let role: "editor" | "viewer" = "editor";
  try {
    const raw = await c.req.json();
    const parsed = InviteSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "Rôle invalide. Valeurs acceptées : editor, viewer." }, 400);
    }
    role = parsed.data.role;
  } catch {
    // No body at all — keep legacy default.
  }

  const token = `inv-${randomUUID()}`;
  const expiresAt = now + 7 * 24 * 60 * 60 * 1000;
  db.prepare(
    `INSERT INTO invitations (token, workspace_id, role, created_at, expires_at, used, created_by) VALUES (?, ?, ?, ?, ?, 0, ?)`,
  ).run(token, id, role, now, expiresAt, auth.userId);
  // SECURITY: never log the raw token — activity_log is readable by all
  // members (including viewers), so a full token there would let a viewer
  // consume someone else's invitation. Only a fingerprint is logged.
  logActivity(id, auth.userId, "invitation.created", "invitation", `inv-…${token.slice(-8)}`);
  return c.json({ token, expiresAt, role });
});

// ── POST /:id/transfer — ownership transfer (spec §2.3) ─────────────────
// Owner-only. Target must already be a member. Atomic swap: the new owner's
// membership becomes `owner`, the previous owner drops to `editor`.

const TransferSchema = z.object({ newOwnerId: z.string().min(1) });

workspaces.post("/:id/transfer", async (c) => {
  const auth = c.get("auth") as AuthContext;
  const id = c.req.param("id");
  const parsed = await safeParseJson(c, TransferSchema);
  if (!parsed.success) return parsed.response;

  const workspace = db.prepare(`SELECT owner_id FROM workspaces WHERE id = ?`).get(id) as
    { owner_id: string } | undefined;
  if (!workspace) return c.json({ error: "Workspace not found" }, 404);
  if (workspace.owner_id !== auth.userId) {
    return c.json({ error: "Only the owner can transfer ownership" }, 403);
  }
  if (parsed.data.newOwnerId === auth.userId) {
    return c.json({ error: "You already own this workspace" }, 400);
  }

  const target = db
    .prepare(`SELECT role FROM memberships WHERE workspace_id = ? AND user_id = ?`)
    .get(id, parsed.data.newOwnerId) as { role: string } | undefined;
  if (!target) {
    return c.json({ error: "The new owner must be a member of this workspace" }, 400);
  }

  const tx = db.transaction(() => {
    db.prepare(`UPDATE workspaces SET owner_id = ?, updated_at = ? WHERE id = ?`).run(
      parsed.data.newOwnerId,
      Date.now(),
      id,
    );
    db.prepare(`UPDATE memberships SET role = 'owner' WHERE workspace_id = ? AND user_id = ?`).run(
      id,
      parsed.data.newOwnerId,
    );
    db.prepare(`UPDATE memberships SET role = 'editor' WHERE workspace_id = ? AND user_id = ?`).run(
      id,
      auth.userId,
    );
    logActivity(id, auth.userId, "ownership.transferred", "membership", parsed.data.newOwnerId);
  });
  tx();

  return c.json({ success: true, newOwnerId: parsed.data.newOwnerId });
});

// ── GET /:id/activity — recent workspace events (spec §5.2) ─────────────

workspaces.get("/:id/activity", (c) => {
  const auth = c.get("auth") as AuthContext;
  const id = c.req.param("id");
  const membership = db
    .prepare(`SELECT 1 FROM memberships WHERE workspace_id = ? AND user_id = ?`)
    .get(id, auth.userId);
  if (!membership) return c.json({ error: "Not a member of this workspace" }, 403);

  const limitRaw = c.req.query("limit");
  const limit = limitRaw && /^\d+$/.test(limitRaw) ? Number(limitRaw) : 50;
  return c.json({ activity: getActivity(id, limit) });
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

// ── DELETE /:id/members/:memberId ────────────────────────────────────────
// Remove a member from the workspace. Only the owner can do this.
// The owner cannot remove themselves.

workspaces.delete("/:id/members/:memberId", (c) => {
  const auth = c.get("auth") as AuthContext;
  const workspaceId = c.req.param("id");
  const memberId = c.req.param("memberId");

  const workspace = db.prepare("SELECT owner_id FROM workspaces WHERE id = ?").get(workspaceId) as
    { owner_id: string } | undefined;
  if (!workspace) return c.json({ error: "Workspace not found" }, 404);
  if (workspace.owner_id !== auth.userId) {
    return c.json({ error: "Only the owner can remove members" }, 403);
  }
  if (memberId === auth.userId) {
    return c.json({ error: "The owner cannot remove themselves from the workspace" }, 400);
  }

  const result = db
    .prepare("DELETE FROM memberships WHERE workspace_id = ? AND user_id = ?")
    .run(workspaceId, memberId);

  if (result.changes === 0) {
    return c.json({ error: "Member not found in this workspace" }, 404);
  }

  logActivity(workspaceId, auth.userId, "member.removed", "membership", memberId);
  return c.json({ success: true });
});

// ── PATCH /:id/members/:memberId ─────────────────────────────────────────
// Change a member's role. Only the owner can do this.
// The owner's role cannot be changed.

workspaces.patch("/:id/members/:memberId", async (c) => {
  const auth = c.get("auth") as AuthContext;
  const workspaceId = c.req.param("id");
  const memberId = c.req.param("memberId");

  const workspace = db.prepare("SELECT owner_id FROM workspaces WHERE id = ?").get(workspaceId) as
    { owner_id: string } | undefined;
  if (!workspace) return c.json({ error: "Workspace not found" }, 404);
  if (workspace.owner_id !== auth.userId) {
    return c.json({ error: "Only the owner can change member roles" }, 403);
  }
  if (memberId === auth.userId) {
    return c.json({ error: "The owner's role cannot be changed" }, 400);
  }

  const parsed = await safeParseJson(c, ChangeRoleSchema);
  if (!parsed.success) return parsed.response;

  const result = db
    .prepare("UPDATE memberships SET role = ? WHERE workspace_id = ? AND user_id = ?")
    .run(parsed.data.role, workspaceId, memberId);

  if (result.changes === 0) {
    return c.json({ error: "Member not found in this workspace" }, 404);
  }

  logActivity(workspaceId, auth.userId, "member.role_changed", "membership", memberId);
  return c.json({ success: true, role: parsed.data.role });
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

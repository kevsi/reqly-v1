import db from "./db.js";

/**
 * Minimal workspace activity log (spec §5.2): key lifecycle events only —
 * resource created/deleted, member joined/removed, role changed, invitation
 * created, ownership transferred. Not an audit-grade trail; a "recent
 * activity" feed for the UI.
 */

export type ActivityAction =
  | "resource.created"
  | "resource.deleted"
  | "member.joined"
  | "member.removed"
  | "member.role_changed"
  | "invitation.created"
  | "ownership.transferred"
  | "workspace.renamed";

export function logActivity(
  workspaceId: string,
  actorId: string,
  action: ActivityAction,
  entityType?: string,
  entityId?: string,
): void {
  db.prepare(
    `INSERT INTO activity_log (workspace_id, actor_id, action, entity_type, entity_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(workspaceId, actorId, action, entityType ?? null, entityId ?? null, Date.now());
}

export interface ActivityEntry {
  id: number;
  actorId: string;
  actorName: string;
  actorEmail: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  createdAt: number;
}

export function getActivity(workspaceId: string, limit = 50): ActivityEntry[] {
  return db
    .prepare(
      `
      SELECT a.id, a.actor_id as actorId, u.name as actorName, u.email as actorEmail,
             a.action, a.entity_type as entityType, a.entity_id as entityId, a.created_at as createdAt
      FROM activity_log a
      JOIN users u ON u.id = a.actor_id
      WHERE a.workspace_id = ?
      ORDER BY a.id DESC
      LIMIT ?
    `,
    )
    .all(workspaceId, Math.min(Math.max(limit, 1), 200)) as ActivityEntry[];
}

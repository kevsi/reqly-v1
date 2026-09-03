import db from "./db.js";
import { logActivity } from "./activity.js";

export interface SyncChange {
  entityType: "collection" | "environment" | "folder";
  id: string;
  data: object;
  updatedAt: number;
  updatedBy: string;
  version: number;
  deleted: boolean;
  /** Provenance (spec §5.1): creator of the entity, when known. */
  createdBy?: string | null;
}

export interface LocalChange {
  entityType: SyncChange["entityType"];
  id: string;
  data: object;
  updatedAt: number;
  updatedBy: string;
  baseVersion?: number;
  deleted?: boolean;
}

export interface PushResult {
  accepted: string[];
  conflicts: Array<{
    entityType: SyncChange["entityType"];
    id: string;
    serverVersion: number;
    serverUpdatedAt: number;
  }>;
}

function tableFor(entityType: SyncChange["entityType"]): string {
  if (entityType === "collection") return "collections";
  if (entityType === "environment") return "environments";
  return "folders";
}

interface ChangeRow {
  id: string;
  data: string;
  version: number;
  updatedAt: number;
  updatedBy: string;
  deleted: number;
}

export function getChangesSince(workspaceId: string, since: number): SyncChange[];
export function getChangesSince(
  workspaceId: string,
  since: number,
  cursor: string | null | undefined,
  limit?: number,
): ChangesPage;
export function getChangesSince(
  workspaceId: string,
  since: number,
  cursor?: string | null,
  limit?: number,
): SyncChange[] | ChangesPage {
  // Legacy two-arg call: return every matching change (used by tests and any
  // caller that wants the full diff). Paged calls go through the UNION query.
  if (arguments.length < 3) {
    const page = queryChanges(workspaceId, since, decodeCursor(null), Number.MAX_SAFE_INTEGER);
    return page.changes;
  }

  const cappedLimit = clampPollLimit(limit);
  const after = cursor ? decodeCursor(cursor) : null;
  return queryChanges(workspaceId, since, after, cappedLimit);
}

/** Default page size for paginated polls; overridable via the `limit` param. */
export const POLL_PAGE_LIMIT_DEFAULT = 500;
/** Hard upper bound — a client asking for more still gets POLL_PAGE_LIMIT_MAX. */
export const POLL_PAGE_LIMIT_MAX = 1000;

export interface ChangesPage {
  changes: SyncChange[];
  /** Cursor of the last returned row (`${updatedAt}|${id}`), or null when done. */
  nextCursor: string | null;
  hasMore: boolean;
}

function clampPollLimit(limit?: number): number {
  const raw = limit ?? POLL_PAGE_LIMIT_DEFAULT;
  if (!Number.isFinite(raw)) return POLL_PAGE_LIMIT_DEFAULT;
  return Math.min(Math.max(Math.trunc(raw), 1), POLL_PAGE_LIMIT_MAX);
}

function decodeCursor(cursor: string | null | undefined): { updatedAt: number; id: string } | null {
  if (!cursor) return null;
  const sep = cursor.indexOf("|");
  if (sep <= 0) throw new Error(`Invalid poll cursor: ${cursor}`);
  const updatedAt = Number(cursor.slice(0, sep));
  const id = cursor.slice(sep + 1);
  if (!Number.isInteger(updatedAt) || !id) throw new Error(`Invalid poll cursor: ${cursor}`);
  return { updatedAt, id };
}

function encodeCursor(change: SyncChange): string {
  return `${change.updatedAt}|${change.id}`;
}

interface RawChangeRow extends ChangeRow {
  entityType: SyncChange["entityType"];
}

/**
 * Keyset-paginated change fetch across the three entity tables.
 *
 * Each branch applies the same keyset predicate `(updated_at > :since) AND
 * (updated_at > :cursorUpdatedAt OR (updated_at = :cursorUpdatedAt AND
 * id > :cursorId))` so the merged stream is ordered by (updated_at ASC,
 * id ASC) and a single `${updatedAt}|${lastId}` cursor resumes exactly where
 * the previous page stopped — rows sharing an identical updated_at are never
 * skipped nor duplicated.
 */
function queryChanges(
  workspaceId: string,
  since: number,
  after: { updatedAt: number; id: string } | null,
  limit: number,
): ChangesPage {
  const branch = (
    table: "collections" | "environments" | "folders",
    // Folders are keyed by their parent collection, not by the workspace.
    // Query them through the workspace's collections so pushed folders
    // actually come back in polls; the other tables filter directly.
    workspaceFilter: string,
  ): string => `
      SELECT '${
        table === "collections" ? "collection" : table === "environments" ? "environment" : "folder"
      }' as entityType, id, data, version, updated_at as updatedAt, updated_by as updatedBy, created_by as createdBy, deleted
      FROM ${table}
      WHERE ${workspaceFilter} AND updated_at > ?
        ${after ? `AND (updated_at > ? OR (updated_at = ? AND id > ?))` : ""}
  `;
  const sql = `
    SELECT * FROM (
      ${branch("collections", "workspace_id = ?")}
      UNION ALL
      ${branch("environments", "workspace_id = ?")}
      UNION ALL
      ${branch("folders", "collection_id IN (SELECT id FROM collections WHERE workspace_id = ?)")}
    )
    ORDER BY updatedAt ASC, id ASC
    LIMIT ?
  `;
  const params: Array<string | number> = [];
  for (let i = 0; i < 3; i++) {
    params.push(workspaceId, since);
    if (after) params.push(after.updatedAt, after.updatedAt, after.id);
  }
  params.push(limit);

  const rows = db.prepare(sql).all(...params) as RawChangeRow[];

  const hasMore = rows.length >= limit && limit !== Number.MAX_SAFE_INTEGER;
  const changes = rows.map((row) => ({
    entityType: row.entityType,
    id: row.id,
    data: JSON.parse(row.data),
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
    createdBy: (row as { createdBy?: string | null }).createdBy ?? null,
    version: row.version,
    deleted: row.deleted === 1,
  }));
  const last = changes[changes.length - 1];
  return {
    changes,
    nextCursor: hasMore && last ? encodeCursor(last) : null,
    hasMore,
  };
}

export function isMember(workspaceId: string, userId: string): boolean {
  const row = db
    .prepare(`SELECT 1 FROM memberships WHERE workspace_id = ? AND user_id = ?`)
    .get(workspaceId, userId);
  return !!row;
}

export function getRole(workspaceId: string, userId: string): string | null {
  const row = db
    .prepare(`SELECT role FROM memberships WHERE workspace_id = ? AND user_id = ?`)
    .get(workspaceId, userId) as { role: string } | undefined;
  return row?.role ?? null;
}

/** view-only members must not push changes (write access requires owner/editor). */
export function canWrite(workspaceId: string, userId: string): boolean {
  const role = getRole(workspaceId, userId);
  return role === "owner" || role === "editor";
}

export function pushChanges(
  workspaceId: string,
  userId: string,
  changes: LocalChange[],
): PushResult {
  const accepted: string[] = [];
  const conflicts: PushResult["conflicts"] = [];
  const logEntries: Array<{ action: string; entityType: string; id: string }> = [];

  const tx = db.transaction(() => {
    for (const change of changes) {
      const table = tableFor(change.entityType);
      const idField = change.entityType === "folder" ? "collection_id" : "workspace_id";

      // Folders are keyed by their parent collection. Reject any folder whose
      // parent collection does not belong to this workspace (orphan / cross-workspace write).
      if (change.entityType === "folder") {
        const parentCollectionId = (change.data as { collectionId?: string }).collectionId ?? "";
        const belongs = db
          .prepare(`SELECT 1 FROM collections WHERE id = ? AND workspace_id = ?`)
          .get(parentCollectionId, workspaceId);
        if (!belongs) {
          conflicts.push({
            entityType: "folder",
            id: change.id,
            serverVersion: 0,
            serverUpdatedAt: 0,
          });
          continue;
        }
      }

      const existing = db
        .prepare(
          `SELECT version, updated_at as updatedAt, ${idField} as scopeId FROM ${table} WHERE id = ?`,
        )
        .get(change.id) as { version: number; updatedAt: number; scopeId: string } | undefined;

      // Tenant isolation: an entity that already lives in another workspace
      // can never be mutated through this one, even if its raw id is known.
      // For folders the scope is the parent collection, so the check is "does
      // the folder's CURRENT collection belong to this workspace" (moving a
      // folder between two collections of the same workspace stays allowed).
      if (existing) {
        const isForeign =
          change.entityType === "folder"
            ? !db
                .prepare(`SELECT 1 FROM collections WHERE id = ? AND workspace_id = ?`)
                .get(existing.scopeId, workspaceId)
            : existing.scopeId !== workspaceId;
        if (isForeign) {
          conflicts.push({
            entityType: change.entityType,
            id: change.id,
            serverVersion: existing.version,
            serverUpdatedAt: existing.updatedAt,
          });
          continue;
        }
      }

      // Optimistic concurrency: when the client sends a baseVersion it must
      // match the server version, otherwise the edit was made on a stale copy
      // (client clock skew can otherwise falsify the updatedAt LWW). Pushes
      // without baseVersion (legacy clients) keep the timestamp LWW behavior.
      if (existing && change.baseVersion !== undefined && change.baseVersion !== existing.version) {
        conflicts.push({
          entityType: change.entityType,
          id: change.id,
          serverVersion: existing.version,
          serverUpdatedAt: existing.updatedAt,
        });
        continue;
      }

      if (existing && existing.updatedAt > change.updatedAt) {
        conflicts.push({
          entityType: change.entityType,
          id: change.id,
          serverVersion: existing.version,
          serverUpdatedAt: existing.updatedAt,
        });
        continue;
      }

      const isNew = !existing;
      const newVersion = (existing?.version ?? 0) + 1;
      const folderCollectionId =
        change.entityType === "folder"
          ? ((change.data as { collectionId?: string }).collectionId ?? "")
          : workspaceId;
      const name = (change.data as { name?: string }).name ?? "";
      const isDeleted = change.deleted ? 1 : 0;

      db.prepare(
        `
        INSERT INTO ${table} (id, ${idField}, name, data, version, updated_at, updated_by, created_by, deleted)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          data = excluded.data,
          version = excluded.version,
          updated_at = excluded.updated_at,
          updated_by = excluded.updated_by,
          deleted = excluded.deleted
      `,
      ).run(
        change.id,
        folderCollectionId,
        name,
        JSON.stringify(change.data),
        newVersion,
        change.updatedAt,
        userId,
        userId, // created_by — set on insert; the ON CONFLICT update never touches it
        isDeleted,
      );

      accepted.push(change.id);
      // Activity log (spec §5.2): key resource lifecycle events only.
      if (isNew) {
        logEntries.push({
          action: "resource.created",
          entityType: change.entityType,
          id: change.id,
        });
      } else if (change.deleted) {
        logEntries.push({
          action: "resource.deleted",
          entityType: change.entityType,
          id: change.id,
        });
      }
    }
  });
  tx();

  // Logged outside the write transaction to keep it lean; failures here must
  // never roll back accepted syncs.
  for (const entry of logEntries) {
    try {
      logActivity(workspaceId, userId, entry.action as never, entry.entityType, entry.id);
    } catch {
      // best-effort
    }
  }

  return { accepted, conflicts };
}

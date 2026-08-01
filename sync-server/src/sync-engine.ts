import db from "./db.js";

export interface SyncChange {
  entityType: "collection" | "environment" | "folder";
  id: string;
  data: object;
  updatedAt: number;
  updatedBy: string;
  version: number;
  deleted: boolean;
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

export function getChangesSince(workspaceId: string, since: number): SyncChange[] {
  const result: SyncChange[] = [];
  for (const entityType of ["collection", "environment", "folder"] as const) {
    const table = tableFor(entityType);
    const idField = entityType === "folder" ? "collection_id" : "workspace_id";
    const rows = db
      .prepare(
        `
      SELECT id, data, version, updated_at as updatedAt, updated_by as updatedBy, deleted
      FROM ${table}
      WHERE ${idField} = ? AND updated_at > ?
      ORDER BY updated_at ASC
    `,
      )
      .all(workspaceId, since) as any[];
    for (const row of rows) {
      result.push({
        entityType,
        id: row.id,
        data: JSON.parse(row.data),
        updatedAt: row.updatedAt,
        updatedBy: row.updatedBy,
        version: row.version,
        deleted: row.deleted === 1,
      });
    }
  }
  return result;
}

export function isMember(workspaceId: string, userId: string): boolean {
  const row = db
    .prepare(`SELECT 1 FROM memberships WHERE workspace_id = ? AND user_id = ?`)
    .get(workspaceId, userId);
  return !!row;
}

export function pushChanges(
  workspaceId: string,
  userId: string,
  changes: LocalChange[],
): PushResult {
  const accepted: string[] = [];
  const conflicts: PushResult["conflicts"] = [];

  const tx = db.transaction(() => {
    for (const change of changes) {
      const table = tableFor(change.entityType);
      const existing = db
        .prepare(`SELECT version, updated_at as updatedAt FROM ${table} WHERE id = ?`)
        .get(change.id) as { version: number; updatedAt: number } | undefined;

      if (existing && existing.updatedAt > change.updatedAt) {
        conflicts.push({
          entityType: change.entityType,
          id: change.id,
          serverVersion: existing.version,
          serverUpdatedAt: existing.updatedAt,
        });
        continue;
      }

      const newVersion = (existing?.version ?? 0) + 1;
      const idField = change.entityType === "folder" ? "collection_id" : "workspace_id";
      const folderCollectionId =
        change.entityType === "folder"
          ? ((change.data as { collectionId?: string }).collectionId ?? "")
          : workspaceId;
      const name = (change.data as { name?: string }).name ?? "";
      const isDeleted = change.deleted ? 1 : 0;

      db.prepare(
        `
        INSERT INTO ${table} (id, ${idField}, name, data, version, updated_at, updated_by, deleted)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
        isDeleted,
      );

      accepted.push(change.id);
    }
  });
  tx();

  return { accepted, conflicts };
}

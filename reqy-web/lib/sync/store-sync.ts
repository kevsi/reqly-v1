import type {
  Collection,
  Environment,
  CollectionFolder,
  RequestStore,
} from "@/hooks/request-types";
import { pollAllSyncChanges } from "@/lib/sync-client";

export interface SyncChange {
  entityType: "collection" | "environment" | "folder";
  id: string;
  data: Collection | Environment | CollectionFolder;
  updatedAt: number;
  updatedBy: string;
  version: number;
  deleted: boolean;
}

export interface LocalPushChange {
  entityType: "collection" | "environment" | "folder";
  id: string;
  data: Collection | Environment | CollectionFolder;
  updatedAt: number;
  updatedBy: string;
  baseVersion?: number;
  deleted?: boolean;
}

/**
 * Diff two local store snapshots and return the local changes to push.
 *
 * - An entity present in `next` with a different `updatedAt` than `prev` is an
 *   add or update.
 * - An entity present in `prev` but missing from `next` is a deletion
 *   (flagged with `deleted: true`).
 * Folders are flattened from their parent collection for comparison.
 */
export function computePushChanges(
  prev: Pick<RequestStore, "collections" | "environments">,
  next: Pick<RequestStore, "collections" | "environments">,
): LocalPushChange[] {
  const changes: LocalPushChange[] = [];

  const diffEntity = (
    entityType: "collection" | "environment" | "folder",
    prevList: Array<{ id: string; updatedAt: number; updatedBy?: string }>,
    nextList: Array<{ id: string; updatedAt: number; updatedBy?: string }>,
    getData: (e: any) => Collection | Environment | CollectionFolder,
  ) => {
    const prevMap = new Map(prevList.map((e) => [e.id, e]));
    const nextIds = new Set(nextList.map((e) => e.id));
    for (const e of nextList) {
      const p = prevMap.get(e.id);
      if (!p || p.updatedAt !== e.updatedAt) {
        changes.push({
          entityType,
          id: e.id,
          data: getData(e),
          updatedAt: e.updatedAt,
          updatedBy: e.updatedBy ?? "unknown",
        });
      }
    }
    const now = Date.now();
    for (const e of prevList) {
      if (!nextIds.has(e.id)) {
        changes.push({
          entityType,
          id: e.id,
          data: getData(e),
          updatedAt: now,
          updatedBy: e.updatedBy ?? "unknown",
          deleted: true,
        });
      }
    }
  };

  diffEntity("collection", prev.collections, next.collections, (e) => e as Collection);
  diffEntity("environment", prev.environments, next.environments, (e) => e as Environment);
  const prevFolders = prev.collections.flatMap((c) => c.folders ?? []);
  const nextFolders = next.collections.flatMap((c) => c.folders ?? []);
  diffEntity("folder", prevFolders, nextFolders, (e) => e as CollectionFolder);

  return changes;
}

/**
 * Pure merge of server-side sync changes into a local store state.
 *
 * Conflict policy: last-write-wins on `updatedAt`. A change with
 * `deleted: true` removes the entity. Folders are merged into their
 * parent collection (resolved via `collectionId` on the folder data).
 *
 * Does NOT mutate the input `store` — returns a new state object.
 */
export function mergeChangesIntoStore(store: RequestStore, changes: SyncChange[]): RequestStore {
  let collections = [...store.collections];
  let environments = [...store.environments];

  for (const change of changes) {
    if (change.entityType === "collection") {
      const incoming = change.data as Collection;
      const idx = collections.findIndex((c) => c.id === change.id);
      if (change.deleted) {
        collections = collections.filter((c) => c.id !== change.id);
      } else if (idx === -1) {
        collections.push(incoming);
      } else if (change.updatedAt > (collections[idx].updatedAt ?? 0)) {
        collections[idx] = incoming;
      }
    } else if (change.entityType === "environment") {
      const incoming = change.data as Environment;
      const idx = environments.findIndex((e) => e.id === change.id);
      if (change.deleted) {
        environments = environments.filter((e) => e.id !== change.id);
      } else if (idx === -1) {
        environments.push(incoming);
      } else if (change.updatedAt > (environments[idx].updatedAt ?? 0)) {
        environments[idx] = incoming;
      }
    } else if (change.entityType === "folder") {
      const incoming = change.data as CollectionFolder;
      const targetId = incoming.collectionId;
      collections = collections.map((c) => {
        if (c.id !== targetId) return c;
        const folders = c.folders ?? [];
        const idx = folders.findIndex((f) => f.id === change.id);
        if (change.deleted) {
          return {
            ...c,
            folders: folders.filter((f) => f.id !== change.id),
            updatedAt: Math.max(c.updatedAt, change.updatedAt),
          };
        }
        if (idx === -1) {
          return {
            ...c,
            folders: [...folders, incoming],
            updatedAt: Math.max(c.updatedAt, change.updatedAt),
          };
        }
        if (change.updatedAt > (folders[idx].updatedAt ?? 0)) {
          return {
            ...c,
            folders: folders.map((f, i) => (i === idx ? incoming : f)),
            updatedAt: Math.max(c.updatedAt, change.updatedAt),
          };
        }
        return c;
      });
    }
  }

  return { ...store, collections, environments };
}

/**
 * Pull all sync changes for a workspace since `since` and apply them.
 *
 * The actual application is delegated to `opts.apply` so this stays
 * decoupled from the Zustand store (the store provides `mergeRemote`,
 * which calls back into `mergeChangesIntoStore` and persists locally).
 *
 * @returns the number of changes that were applied.
 */
export async function pullAndMerge(
  workspaceId: string,
  since: number,
  opts: { token?: string; apply?: (changes: SyncChange[]) => void } = {},
): Promise<{ applied: number }> {
  const changes: SyncChange[] = [];
  for await (const c of pollAllSyncChanges({ workspaceId, since }, { token: opts.token })) {
    changes.push(c as SyncChange);
  }
  if (changes.length > 0 && opts.apply) {
    opts.apply(changes);
  }
  return { applied: changes.length };
}

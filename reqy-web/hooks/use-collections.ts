"use client";

/**
 * Domain hook: collections — typed Zustand selector with workspace filtering.
 *
 * Usage:
 *   const { collections, addCollection, deleteCollection } = useCollections();
 *   const { collections: wsCollections } = useCollections({ scoped: true });
 */

import { useRequestStore, requestStore } from "@/hooks/use-request-store";
import type { Collection, CollectionFolder, RequestItem } from "@/hooks/request-types";
import { WORKSPACE_PERSONAL_ID } from "@/hooks/store/types";

export interface UseCollectionsOptions {
  /** Filter collections to the active workspace (default: true). */
  scoped?: boolean;
}

export function useCollections(options: UseCollectionsOptions = {}) {
  const { scoped = true } = options;

  const collections = useRequestStore((s) => {
    if (!scoped) return s.collections;
    const wsId = s.activeWorkspaceId ?? WORKSPACE_PERSONAL_ID;
    return s.collections.filter((c) => c.workspaceId === wsId);
  });

  const addCollection = useRequestStore((s) => s.addCollection);
  const updateCollection = useRequestStore((s) => s.updateCollection);
  const deleteCollection = useRequestStore((s) => s.deleteCollection);
  const duplicateCollection = useRequestStore((s) => s.duplicateCollection);
  const reorderCollections = useRequestStore((s) => s.reorderCollections);

  const addRequestToCollection = useRequestStore((s) => s.addRequestToCollection);
  const removeRequestFromCollection = useRequestStore((s) => s.removeRequestFromCollection);
  const updateRequestInCollection = useRequestStore((s) => s.updateRequestInCollection);
  const updateRequestById = useRequestStore((s) => s.updateRequestById);

  const getFoldersForCollection = useRequestStore((s) => s.getFoldersForCollection);

  return {
    collections,
    addCollection,
    updateCollection,
    deleteCollection,
    duplicateCollection,
    reorderCollections,
    addRequestToCollection,
    removeRequestFromCollection,
    updateRequestInCollection,
    updateRequestById,
    getFoldersForCollection,
  };
}

// ── Standalone helpers (for use outside React components) ────────────────

export function findCollection(id: string): Collection | undefined {
  return requestStore.getState().collections.find((c) => c.id === id);
}

export function findRequestInCollection(
  collectionId: string,
  requestId: string,
): RequestItem | undefined {
  const col = findCollection(collectionId);
  return col?.requests.find((r) => r.id === requestId);
}

export function findRequestGlobally(requestId: string): RequestItem | undefined {
  for (const col of requestStore.getState().collections) {
    const found = col.requests.find((r) => r.id === requestId);
    if (found) return found;
  }
  return undefined;
}

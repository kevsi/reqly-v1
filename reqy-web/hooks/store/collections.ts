import type { Collection, RequestItem } from "@/hooks/request-types";
import { computeOrder } from "@/lib/types";
import { resolveUniqueCollectionName } from "@/lib/import-schemas";
import { CommitFn, WORKSPACE_PERSONAL_ID } from "./types";
import { toast } from "sonner";

export function createCollectionsMutations(commit: CommitFn) {
  const addCollection = (
    data: Omit<Collection, "id" | "createdAt" | "updatedAt" | "requests"> & {
      requests?: RequestItem[];
    },
  ) => {
    const id = `col-${crypto.randomUUID()}`;
    commit((prev) => {
      const wsId = prev.activeWorkspaceId ?? WORKSPACE_PERSONAL_ID;
      return {
        ...prev,
        collections: [
          ...prev.collections,
          {
            ...data,
            workspaceId: wsId,
            id,
            requests: data.requests ?? [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ],
      };
    });
    return id;
  };

  const updateCollection = (id: string, updates: Partial<Collection>) => {
    commit((prev) => ({
      ...prev,
      collections: prev.collections.map((c) =>
        c.id === id ? { ...c, ...updates, updatedAt: Date.now() } : c,
      ),
    }));
  };

  const deleteCollection = (id: string) => {
    commit((prev) => ({
      ...prev,
      collections: prev.collections.filter((c) => c.id !== id),
    }));
  };

  const duplicateCollection = (id: string) => {
    commit((prev) => {
      const source = prev.collections.find((c) => c.id === id);
      if (!source) return prev;
      const now = Date.now();
      const newId = `col-${crypto.randomUUID()}`;
      const duplicate: Collection = {
        ...source,
        id: newId,
        name: resolveUniqueCollectionName(
          source.name,
          prev.collections.filter((c) => c.id !== id).map((c) => c.name),
        ),
        requests: source.requests.map((r) => ({
          ...r,
          id: `req-${crypto.randomUUID()}`,
          createdAt: now,
          updatedAt: now,
        })),
        folders: source.folders?.map((f) => ({
          ...f,
          id: `folder-${crypto.randomUUID()}`,
          collectionId: newId,
          createdAt: now,
          updatedAt: now,
        })),
        createdAt: now,
        updatedAt: now,
      };
      return {
        ...prev,
        collections: [...prev.collections, duplicate],
      };
    });
  };

  const reorderCollections = (ids: string[]) => {
    commit((prev) => {
      const reordered = ids
        .map((id) => prev.collections.find((c) => c.id === id))
        .filter(Boolean) as Collection[];
      const remaining = prev.collections.filter((c) => !ids.includes(c.id));
      return {
        ...prev,
        collections: [...reordered, ...remaining],
      };
    });
    toast.success("Collection réorganisée");
  };

  const addRequestToCollection = (
    collectionId: string,
    data: Omit<RequestItem, "id" | "createdAt" | "updatedAt">,
  ) => {
    const id = `req-${crypto.randomUUID()}`;
    commit((prev) => {
      const collection = prev.collections.find((c) => c.id === collectionId);
      const maxOrder = collection
        ? Math.max(0, ...collection.requests.map((r) => r.order ?? 0))
        : 0;
      return {
        ...prev,
        collections: prev.collections.map((c) =>
          c.id === collectionId
            ? {
                ...c,
                updatedAt: Date.now(),
                requests: [
                  ...c.requests,
                  {
                    ...data,
                    id,
                    order: data.order ?? maxOrder + 1000,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                  },
                ],
              }
            : c,
        ),
      };
    });
    return id;
  };

  const removeRequestFromCollection = (collectionId: string, requestId: string) => {
    commit((prev) => ({
      ...prev,
      collections: prev.collections.map((c) =>
        c.id === collectionId
          ? {
              ...c,
              updatedAt: Date.now(),
              requests: c.requests.filter((r) => r.id !== requestId),
            }
          : c,
      ),
    }));
  };

  const updateRequestInCollection = (
    collectionId: string,
    requestId: string,
    updates: Partial<RequestItem>,
  ) => {
    commit((prev) => ({
      ...prev,
      collections: prev.collections.map((c) =>
        c.id === collectionId
          ? {
              ...c,
              updatedAt: Date.now(),
              requests: c.requests.map((r) =>
                r.id === requestId ? { ...r, ...updates, updatedAt: Date.now() } : r,
              ),
            }
          : c,
      ),
    }));
  };

  const updateRequestById = (requestId: string, updates: Partial<RequestItem>) => {
    commit((prev) => ({
      ...prev,
      collections: prev.collections.map((c) => ({
        ...c,
        updatedAt: c.requests.some((r) => r.id === requestId) ? Date.now() : c.updatedAt,
        requests: c.requests.map((r) =>
          r.id === requestId ? { ...r, ...updates, updatedAt: Date.now() } : r,
        ),
      })),
    }));
  };

  const moveRequestBetweenCollections = (
    sourceCollectionId: string,
    targetCollectionId: string,
    requestId: string,
    targetIndex?: number,
  ) => {
    if (sourceCollectionId === targetCollectionId) return;
    commit((prev) => {
      const sourceCol = prev.collections.find((c) => c.id === sourceCollectionId);
      const targetCol = prev.collections.find((c) => c.id === targetCollectionId);
      if (!sourceCol || !targetCol) return prev;

      const request = sourceCol.requests.find((r) => r.id === requestId);
      if (!request) return prev;

      const now = Date.now();
      const targetRequests = targetCol.requests;
      const insertAt = targetIndex ?? targetRequests.length;
      const prevOrder = insertAt > 0 ? (targetRequests[insertAt - 1]?.order ?? 0) : null;
      const nextOrder =
        insertAt < targetRequests.length ? (targetRequests[insertAt]?.order ?? null) : null;
      const order = computeOrder(prevOrder, nextOrder, 2000);

      const movedRequest: RequestItem = {
        ...request,
        order,
        updatedAt: now,
      };

      return {
        ...prev,
        collections: prev.collections.map((c) => {
          if (c.id === sourceCollectionId) {
            return {
              ...c,
              updatedAt: now,
              requests: c.requests.filter((r) => r.id !== requestId),
            };
          }
          if (c.id === targetCollectionId) {
            const newRequests = [...c.requests];
            newRequests.splice(insertAt, 0, movedRequest);
            return {
              ...c,
              updatedAt: now,
              requests: newRequests,
            };
          }
          return c;
        }),
      };
    });
  };

  return {
    addCollection,
    updateCollection,
    deleteCollection,
    duplicateCollection,
    reorderCollections,
    addRequestToCollection,
    removeRequestFromCollection,
    updateRequestInCollection,
    updateRequestById,
    moveRequestBetweenCollections,
  };
}

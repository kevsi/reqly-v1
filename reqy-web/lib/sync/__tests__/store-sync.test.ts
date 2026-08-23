import { describe, it, expect, vi } from "vitest";
import type {
  Collection,
  Environment,
  CollectionFolder,
  RequestStore,
} from "@/hooks/request-types";
import { pollAllSyncChanges } from "@/lib/sync-client";
import { mergeChangesIntoStore, pullAndMerge, type SyncChange } from "@/lib/sync/store-sync";

vi.mock("@/lib/sync-client", () => ({
  pollAllSyncChanges: vi.fn(),
}));

function baseStore(): RequestStore {
  return {
    history: [],
    collections: [],
    environments: [],
    notifications: [],
    variableMappings: [],
    activeEnvironmentId: null,
    projects: [],
    selectedProjectId: null,
    currentRequest: null,
    lastResponse: null,
    environmentVariables: {},
    collectionHistory: [],
    activeCollection: null,
    aiAutoApply: false,
    aiAudit: [],
    workspaces: [],
    activeWorkspaceId: "ws-1",
    datasets: [],
  } as unknown as RequestStore;
}

const col = (id: string, updatedAt: number, extra: Partial<Collection> = {}): Collection => ({
  id,
  name: `C-${id}`,
  workspaceId: "ws-1",
  requests: [],
  createdAt: updatedAt,
  updatedAt,
  ...extra,
});

const env = (id: string, updatedAt: number, extra: Partial<Environment> = {}): Environment => ({
  id,
  name: `E-${id}`,
  workspaceId: "ws-1",
  variables: [],
  createdAt: updatedAt,
  updatedAt,
  ...extra,
});

const folder = (id: string, collectionId: string, updatedAt: number): CollectionFolder => ({
  id,
  name: `F-${id}`,
  collectionId,
  parentId: null,
  order: 0,
  createdAt: updatedAt,
  updatedAt,
});

// `updatedAt` defaults to the entity's own updatedAt so callers don't repeat it.
const change = (
  partial: Partial<SyncChange> & Pick<SyncChange, "entityType" | "id" | "data">,
): SyncChange => ({
  updatedBy: "u",
  version: 1,
  deleted: false,
  updatedAt: partial.data.updatedAt,
  ...partial,
});

describe("mergeChangesIntoStore", () => {
  it("adds a new collection from server", () => {
    const store = baseStore();
    const next = mergeChangesIntoStore(store, [
      change({ entityType: "collection", id: "c1", data: col("c1", 100) }),
    ]);
    expect(next.collections).toHaveLength(1);
    expect(next.collections[0].id).toBe("c1");
  });

  it("strips request and environment secrets from remote changes", () => {
    const next = mergeChangesIntoStore(baseStore(), [
      change({
        entityType: "collection",
        id: "c1",
        data: col("c1", 100, {
          requests: [
            {
              id: "r1",
              name: "Secret request",
              method: "GET",
              url: "https://example.com",
              endpoint: "https://example.com",
              authToken: "bearer-secret",
              headers: {
                Authorization: "Bearer secret",
                "X-API-Key": "api-secret",
                Accept: "application/json",
              },
              createdAt: 100,
              updatedAt: 100,
            },
          ],
        }),
      }),
      change({
        entityType: "environment",
        id: "e1",
        data: env("e1", 100, {
          variables: [
            { key: "API_TOKEN", value: "secret", enabled: true },
            { key: "BASE_URL", value: "https://example.com", enabled: true },
          ],
        }),
      }),
    ]);

    expect(next.collections[0].requests[0].authToken).toBe("");
    expect(next.collections[0].requests[0].headers).toEqual({ Accept: "application/json" });
    expect(next.environments[0].variables[0].value).toBe("");
    expect(next.environments[0].variables[1].value).toBe("https://example.com");
  });

  it("updates an existing collection when server is newer (LWW on updatedAt)", () => {
    const store = baseStore();
    store.collections = [col("c1", 100, { name: "old" })];
    const next = mergeChangesIntoStore(store, [
      change({ entityType: "collection", id: "c1", data: col("c1", 200, { name: "new" }) }),
    ]);
    expect(next.collections[0].name).toBe("new");
    expect(next.collections[0].updatedAt).toBe(200);
  });

  it("keeps local collection when local is newer (skips older server change)", () => {
    const store = baseStore();
    store.collections = [col("c1", 300, { name: "local" })];
    const next = mergeChangesIntoStore(store, [
      change({ entityType: "collection", id: "c1", data: col("c1", 200, { name: "stale" }) }),
    ]);
    expect(next.collections[0].name).toBe("local");
    expect(next.collections[0].updatedAt).toBe(300);
  });

  it("removes a collection when server marks it deleted", () => {
    const store = baseStore();
    store.collections = [col("c1", 100)];
    const next = mergeChangesIntoStore(store, [
      change({ entityType: "collection", id: "c1", data: col("c1", 200), deleted: true }),
    ]);
    expect(next.collections).toHaveLength(0);
  });

  it("adds/updates/removes an environment", () => {
    const store = baseStore();
    let next = mergeChangesIntoStore(store, [
      change({ entityType: "environment", id: "e1", data: env("e1", 100) }),
    ]);
    expect(next.environments).toHaveLength(1);
    next = mergeChangesIntoStore(next, [
      change({ entityType: "environment", id: "e1", data: env("e1", 200, { name: "renamed" }) }),
    ]);
    expect(next.environments[0].name).toBe("renamed");
    next = mergeChangesIntoStore(next, [
      change({ entityType: "environment", id: "e1", data: env("e1", 300), deleted: true }),
    ]);
    expect(next.environments).toHaveLength(0);
  });

  it("adds/updates/removes a folder inside its collection (collectionId)", () => {
    const store = baseStore();
    store.collections = [col("c1", 100)];
    let next = mergeChangesIntoStore(store, [
      change({ entityType: "folder", id: "f1", data: folder("f1", "c1", 100) }),
    ]);
    expect(next.collections[0].folders).toHaveLength(1);
    expect(next.collections[0].folders?.[0].id).toBe("f1");
    next = mergeChangesIntoStore(next, [
      change({ entityType: "folder", id: "f1", data: folder("f1", "c1", 200) }),
    ]);
    expect(next.collections[0].folders?.[0].updatedAt).toBe(200);
    next = mergeChangesIntoStore(next, [
      change({ entityType: "folder", id: "f1", data: folder("f1", "c1", 300), deleted: true }),
    ]);
    expect(next.collections[0].folders).toHaveLength(0);
  });

  it("does not mutate the input store (pure)", () => {
    const store = baseStore();
    store.collections = [col("c1", 100)];
    mergeChangesIntoStore(store, [
      change({ entityType: "collection", id: "c2", data: col("c2", 200) }),
    ]);
    expect(store.collections).toHaveLength(1);
  });
});

describe("pullAndMerge", () => {
  it("polls changes and applies them via the apply callback", async () => {
    const polled: SyncChange[] = [
      change({ entityType: "collection", id: "c1", data: col("c1", 100) }),
      change({ entityType: "environment", id: "e1", data: env("e1", 100) }),
    ];
    vi.mocked(pollAllSyncChanges).mockImplementation(async function* () {
      for (const c of polled) yield c;
    });
    const apply = vi.fn();
    const result = await pullAndMerge("ws-1", 0, { apply });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0][0]).toHaveLength(2);
    expect(result.applied).toBe(2);
  });

  it("does not call apply when there are no changes", async () => {
    vi.mocked(pollAllSyncChanges).mockImplementation(async function* () {});
    const apply = vi.fn();
    const result = await pullAndMerge("ws-1", 0, { apply });
    expect(apply).not.toHaveBeenCalled();
    expect(result.applied).toBe(0);
  });
});

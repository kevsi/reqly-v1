import { describe, it, expect, vi } from "vitest";
import type {
  Collection,
  Environment,
  CollectionFolder,
  RequestStore,
} from "@/hooks/request-types";
import { computePushChanges, type LocalPushChange } from "@/lib/sync/store-sync";
import { pushChanges } from "@/lib/sync-client";

const col = (id: string, updatedAt: number, folders: CollectionFolder[] = []): Collection => ({
  id,
  name: `C-${id}`,
  workspaceId: "ws-1",
  requests: [],
  folders,
  createdAt: updatedAt,
  updatedAt,
});

const env = (id: string, updatedAt: number): Environment => ({
  id,
  name: `E-${id}`,
  workspaceId: "ws-1",
  variables: [],
  createdAt: updatedAt,
  updatedAt,
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

const slice = (s: Partial<RequestStore>): Pick<RequestStore, "collections" | "environments"> =>
  s as Pick<RequestStore, "collections" | "environments">;

describe("computePushChanges", () => {
  it("detects added and updated collections", () => {
    const prev = slice({ collections: [col("c1", 100)], environments: [] });
    const next = slice({ collections: [col("c1", 200), col("c2", 200)], environments: [] });
    const changes = computePushChanges(prev, next);
    const byId = Object.fromEntries(changes.map((c) => [c.id, c]));
    expect(changes).toHaveLength(2);
    expect(byId["c1"].deleted).toBeUndefined();
    expect(byId["c1"].updatedAt).toBe(200);
    expect(byId["c2"].updatedAt).toBe(200);
  });

  it("detects deleted collections", () => {
    const prev = slice({ collections: [col("c1", 100), col("c2", 100)], environments: [] });
    const next = slice({ collections: [col("c1", 100)], environments: [] });
    const changes = computePushChanges(prev, next);
    const deleted = changes.find((c) => c.id === "c2");
    expect(deleted).toBeDefined();
    expect(deleted?.deleted).toBe(true);
  });

  it("detects added/updated/deleted environments", () => {
    const prev = slice({ collections: [], environments: [env("e1", 100)] });
    const next = slice({ collections: [], environments: [env("e1", 200), env("e2", 200)] });
    const changes = computePushChanges(prev, next);
    const byId = Object.fromEntries(changes.map((c) => [c.id, c]));
    expect(changes).toHaveLength(2);
    expect(byId["e1"].updatedAt).toBe(200);
    expect(byId["e2"].deleted).toBeUndefined();
  });

  it("detects added/updated/deleted folders nested in collections", () => {
    const prev = slice({
      collections: [col("c1", 100, [folder("f1", "c1", 100)])],
      environments: [],
    });
    const next = slice({
      collections: [col("c1", 200, [folder("f1", "c1", 200), folder("f2", "c1", 200)])],
      environments: [],
    });
    const changes = computePushChanges(prev, next);
    const folders = changes.filter((c) => c.entityType === "folder");
    const byId = Object.fromEntries(folders.map((c) => [c.id, c]));
    expect(folders).toHaveLength(2);
    expect(byId["f1"].updatedAt).toBe(200);
    expect(byId["f2"].deleted).toBeUndefined();
  });

  it("reports no changes when states are equal", () => {
    const s = slice({ collections: [col("c1", 100)], environments: [env("e1", 100)] });
    expect(computePushChanges(s, s)).toHaveLength(0);
  });
});

describe("pushChanges (client)", () => {
  it("POSTs changes to /api/sync/push with workspaceId + changes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ accepted: ["c1"], conflicts: [] }) });
    vi.stubGlobal("fetch", fetchMock);

    const changes: LocalPushChange[] = [
      { entityType: "collection", id: "c1", data: col("c1", 100), updatedAt: 100, updatedBy: "u" },
    ];
    const res = await pushChanges("ws-1", changes, { baseUrl: "http://sync.test" });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://sync.test/api/sync/push",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.workspaceId).toBe("ws-1");
    expect(body.changes).toHaveLength(1);
    expect(res.accepted).toEqual(["c1"]);
  });
});

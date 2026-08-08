import { describe, it, expect, beforeEach } from "vitest";
import db from "../db.js";
import { getChangesSince, pushChanges, isMember } from "../sync-engine.js";

const WS = "ws-test";
const USER_A = "user-a";
const USER_B = "user-b";

describe("sync engine", () => {
  beforeEach(() => {
    db.exec(
      "DELETE FROM folders; DELETE FROM environments; DELETE FROM collections; DELETE FROM memberships; DELETE FROM invitations; DELETE FROM workspaces; DELETE FROM users;",
    );
    db.prepare("INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)").run(
      USER_A,
      "a@x",
      "A",
      1,
    );
    db.prepare("INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)").run(
      USER_B,
      "b@x",
      "B",
      1,
    );
    db.prepare(
      "INSERT INTO workspaces (id, name, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run(WS, "Test", USER_A, 1, 1);
    db.prepare(
      "INSERT INTO memberships (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)",
    ).run(WS, USER_A, "owner", 1);
  });

  it("isMember returns true for member", () => {
    expect(isMember(WS, USER_A)).toBe(true);
  });

  it("isMember returns false for non-member", () => {
    expect(isMember(WS, USER_B)).toBe(false);
  });

  it("pushChanges inserts new collection", () => {
    const result = pushChanges(WS, USER_A, [
      {
        entityType: "collection",
        id: "col-1",
        data: { id: "col-1", name: "Test", requests: [] },
        updatedAt: Date.now(),
        updatedBy: USER_A,
      },
    ]);
    expect(result.accepted).toEqual(["col-1"]);
    expect(result.conflicts).toEqual([]);
  });

  it("getChangesSince returns pushed changes", () => {
    pushChanges(WS, USER_A, [
      {
        entityType: "collection",
        id: "col-1",
        data: { name: "Test" },
        updatedAt: Date.now(),
        updatedBy: USER_A,
      },
    ]);
    const changes = getChangesSince(WS, 0);
    expect(changes.length).toBeGreaterThanOrEqual(1);
    const col = changes.find((c) => c.id === "col-1");
    expect(col).toBeDefined();
    expect(col?.entityType).toBe("collection");
  });

  it("LWW: newer server version rejects client push (conflict)", () => {
    const oldTime = Date.now() - 1000;
    pushChanges(WS, USER_A, [
      {
        entityType: "collection",
        id: "col-1",
        data: { name: "First" },
        updatedAt: oldTime,
        updatedBy: USER_A,
      },
    ]);
    const result = pushChanges(WS, USER_B, [
      {
        entityType: "collection",
        id: "col-1",
        data: { name: "Stale" },
        updatedAt: oldTime - 500,
        updatedBy: USER_B,
      },
    ]);
    expect(result.accepted).toEqual([]);
    expect(result.conflicts).toHaveLength(1);
  });

  it("LWW: newer client push updates server", () => {
    pushChanges(WS, USER_A, [
      {
        entityType: "collection",
        id: "col-1",
        data: { name: "Old" },
        updatedAt: Date.now() - 1000,
        updatedBy: USER_A,
      },
    ]);
    const result = pushChanges(WS, USER_B, [
      {
        entityType: "collection",
        id: "col-1",
        data: { name: "New" },
        updatedAt: Date.now(),
        updatedBy: USER_B,
      },
    ]);
    expect(result.accepted).toEqual(["col-1"]);
    const changes = getChangesSince(WS, Date.now() - 100);
    const col = changes.find((c) => c.id === "col-1");
    expect(col?.data).toMatchObject({ name: "New" });
  });

  it("pushChanges with deleted: true stores the entity as deleted", () => {
    const ts = Date.now();
    // First push the collection as normal
    pushChanges(WS, USER_A, [
      {
        entityType: "collection",
        id: "col-del",
        data: { id: "col-del", name: "ToDelete" },
        updatedAt: ts,
        updatedBy: USER_A,
      },
    ]);
    // Then push with deleted: true
    const result = pushChanges(WS, USER_A, [
      {
        entityType: "collection",
        id: "col-del",
        data: { id: "col-del", name: "ToDelete" },
        updatedAt: ts + 100,
        updatedBy: USER_A,
        deleted: true,
      },
    ]);
    expect(result.accepted).toEqual(["col-del"]);
    expect(result.conflicts).toEqual([]);
    // Verify via getChangesSince
    const changes = getChangesSince(WS, 0);
    const deleted = changes.find((c) => c.id === "col-del");
    expect(deleted).toBeDefined();
    expect(deleted?.deleted).toBe(true);
  });

  it("folders round-trip: push then poll returns the folder (H1 regression)", () => {
    // Parent collection must exist in the workspace first.
    pushChanges(WS, USER_A, [
      {
        entityType: "collection",
        id: "col-parent",
        data: { id: "col-parent", name: "Parent" },
        updatedAt: Date.now(),
        updatedBy: USER_A,
      },
    ]);
    const ts = Date.now();
    const result = pushChanges(WS, USER_B, [
      {
        entityType: "folder",
        id: "folder-1",
        data: { id: "folder-1", name: "Auth", collectionId: "col-parent" },
        updatedAt: ts,
        updatedBy: USER_B,
      },
    ]);
    expect(result.accepted).toEqual(["folder-1"]);
    expect(result.conflicts).toEqual([]);

    const changes = getChangesSince(WS, 0);
    const folder = changes.find((c) => c.id === "folder-1");
    expect(folder).toBeDefined();
    expect(folder?.entityType).toBe("folder");
    expect(folder?.data).toMatchObject({ name: "Auth", collectionId: "col-parent" });
  });

  it("rejects a folder whose parent collection is not in the workspace", () => {
    const ts = Date.now();
    const result = pushChanges(WS, USER_A, [
      {
        entityType: "folder",
        id: "folder-evil",
        data: { id: "folder-evil", name: "Orphan", collectionId: "other-ws-collection" },
        updatedAt: ts,
        updatedBy: USER_A,
      },
    ]);
    expect(result.accepted).toEqual([]);
    expect(result.conflicts).toHaveLength(1);
    expect(getChangesSince(WS, 0).find((c) => c.id === "folder-evil")).toBeUndefined();
  });

  it("getChangesSince filters by timestamp", () => {
    pushChanges(WS, USER_A, [
      {
        entityType: "collection",
        id: "col-1",
        data: { name: "Old" },
        updatedAt: 1000,
        updatedBy: USER_A,
      },
    ]);
    pushChanges(WS, USER_A, [
      {
        entityType: "environment",
        id: "env-1",
        data: { name: "Env" },
        updatedAt: 2000,
        updatedBy: USER_A,
      },
    ]);
    expect(getChangesSince(WS, 1500).length).toBeLessThan(getChangesSince(WS, 0).length);
  });
});

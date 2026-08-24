import { describe, it, expect, beforeEach } from "vitest";
import db from "../db.js";
import { getChangesSince, pushChanges, isMember, type ChangesPage } from "../sync-engine.js";

const WS = "ws-test";
const USER_A = "user-a";
const USER_B = "user-b";

describe("sync engine", () => {
  beforeEach(() => {
    db.exec(
      "DELETE FROM activity_log; DELETE FROM folders; DELETE FROM environments; DELETE FROM collections; DELETE FROM activity_log; DELETE FROM memberships; DELETE FROM invitations; DELETE FROM workspaces; DELETE FROM users;",
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

describe("sync engine — poll pagination (keyset cursor)", () => {
  beforeEach(() => {
    db.exec(
      "DELETE FROM activity_log; DELETE FROM folders; DELETE FROM environments; DELETE FROM collections; DELETE FROM memberships; DELETE FROM invitations; DELETE FROM workspaces; DELETE FROM users;",
    );
    db.prepare("INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)").run(
      USER_A,
      "a@x",
      "A",
      1,
    );
    db.prepare(
      "INSERT INTO workspaces (id, name, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run(WS, "Test", USER_A, 1, 1);
    db.prepare(
      "INSERT INTO memberships (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)",
    ).run(WS, USER_A, "owner", 1);
  });

  it("paginates more changes than the limit without loss or duplication", () => {
    const total = 25;
    for (let i = 0; i < total; i++) {
      pushChanges(WS, USER_A, [
        {
          entityType: "collection",
          id: `col-${String(i).padStart(2, "0")}`,
          data: { name: `C${i}` },
          updatedAt: 1000 + i,
          updatedBy: USER_A,
        },
      ]);
    }

    const seen: Array<{ updatedAt: number; id: string }> = [];
    let cursor: string | null = null;
    do {
      const page: ChangesPage = getChangesSince(WS, 0, cursor, 10);
      for (const change of page.changes) {
        seen.push({ updatedAt: change.updatedAt, id: change.id });
      }
      cursor = page.nextCursor;
    } while (cursor);

    // No loss, no duplication.
    expect(seen).toHaveLength(total);
    expect(new Set(seen.map((c) => c.id)).size).toBe(total);
    // Strict keyset ordering preserved across pages: (updatedAt ASC, id ASC).
    for (let i = 1; i < seen.length; i++) {
      const prev = seen[i - 1];
      const cur = seen[i];
      expect(
        cur.updatedAt > prev.updatedAt || (cur.updatedAt === prev.updatedAt && cur.id > prev.id),
      ).toBe(true);
    }
  });

  it("returns rows sharing an identical updated_at exactly once across pages (tie-break by id)", () => {
    pushChanges(WS, USER_A, [
      {
        entityType: "collection",
        id: "col-parent-tie",
        data: { name: "Parent" },
        updatedAt: 4000,
        updatedBy: USER_A,
      },
    ]);
    // Three entity types sharing the SAME timestamp: the keyset predicate must
    // still walk them deterministically via the id tie-break.
    pushChanges(WS, USER_A, [
      {
        entityType: "collection",
        id: "b-col",
        data: { name: "C" },
        updatedAt: 5000,
        updatedBy: USER_A,
      },
      {
        entityType: "environment",
        id: "b-env",
        data: { name: "E" },
        updatedAt: 5000,
        updatedBy: USER_A,
      },
      {
        entityType: "folder",
        id: "b-folder",
        data: { name: "F", collectionId: "col-parent-tie" },
        updatedAt: 5000,
        updatedBy: USER_A,
      },
    ]);

    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const page: ChangesPage = getChangesSince(WS, 0, cursor, 2);
      ids.push(...page.changes.map((c) => c.id));
      cursor = page.nextCursor;
    } while (cursor);

    expect(ids).toEqual(["col-parent-tie", "b-col", "b-env", "b-folder"]);
    expect(new Set(ids).size).toBe(4);
  });

  it("reports hasMore=false and a null cursor when everything fits on one page", () => {
    pushChanges(WS, USER_A, [
      {
        entityType: "collection",
        id: "col-single",
        data: { name: "Only" },
        updatedAt: Date.now(),
        updatedBy: USER_A,
      },
    ]);
    const page = getChangesSince(WS, 0, null, 10);
    expect(page.changes).toHaveLength(1);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });
});

describe("cross-workspace isolation", () => {
  beforeEach(() => {
    // Self-contained seed: this describe sits outside the main one above.
    db.exec(
      "DELETE FROM activity_log; DELETE FROM folders; DELETE FROM environments; DELETE FROM collections; DELETE FROM activity_log; DELETE FROM memberships; DELETE FROM invitations; DELETE FROM workspaces; DELETE FROM users;",
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
    ).run(WS, "A ws", USER_A, 1, 1);
    db.prepare(
      "INSERT INTO memberships (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)",
    ).run(WS, USER_A, "owner", 1);
    db.prepare(
      "INSERT INTO workspaces (id, name, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("ws-b", "B ws", USER_B, 1, 1);
    db.prepare(
      "INSERT INTO memberships (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)",
    ).run("ws-b", USER_B, "owner", 1);
  });

  it("rejects mutation of an entity belonging to another workspace", () => {
    // col-secret lives in WS (owned by USER_A)
    pushChanges(WS, USER_A, [
      {
        entityType: "collection",
        id: "col-secret",
        data: { name: "Secret" },
        updatedAt: 1000,
        updatedBy: USER_A,
      },
    ]);

    // USER_B pushes a DELETE targeting col-secret THROUGH his own workspace.
    const result = pushChanges("ws-b", USER_B, [
      {
        entityType: "collection",
        id: "col-secret",
        data: { name: "Hacked" },
        deleted: true,
        updatedAt: Date.now() + 5000,
        updatedBy: USER_B,
      },
    ]);
    expect(result.accepted).toEqual([]);
    expect(result.conflicts).toHaveLength(1);

    // The victim entity stays intact inside its own workspace.
    const row = db
      .prepare(`SELECT deleted, workspace_id FROM collections WHERE id = 'col-secret'`)
      .get() as {
      deleted: number;
      workspace_id: string;
    };
    expect(row.deleted).toBe(0);
    expect(row.workspace_id).toBe(WS);
  });
});


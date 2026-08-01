import { describe, it, expect, beforeEach } from "vitest";
import db from "../db.js";

describe("sync-server DB", () => {
  beforeEach(() => {
    // Each test starts from a known-empty state. We rely on the singleton
    // db.ts opens on import; this just clears rows from the relevant tables.
    db.exec(`
      DELETE FROM folders;
      DELETE FROM environments;
      DELETE FROM collections;
      DELETE FROM memberships;
      DELETE FROM invitations;
      DELETE FROM workspaces;
      DELETE FROM users;
    `);
  });

  describe("tables", () => {
    it("creates all expected tables", () => {
      const rows = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all() as { name: string }[];
      const names = rows.map((r) => r.name);

      for (const expected of [
        "collections",
        "environments",
        "folders",
        "invitations",
        "memberships",
        "users",
        "workspaces",
      ]) {
        expect(names).toContain(expected);
      }
    });

    it("users has the expected columns", () => {
      const cols = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
      const names = cols.map((c) => c.name);
      expect(names).toEqual(expect.arrayContaining(["id", "email", "name", "created_at"]));
    });

    it("workspaces has the expected columns", () => {
      const cols = db.prepare("PRAGMA table_info(workspaces)").all() as { name: string }[];
      const names = cols.map((c) => c.name);
      expect(names).toEqual(
        expect.arrayContaining(["id", "name", "owner_id", "created_at", "updated_at"]),
      );
    });

    it("memberships has the expected columns", () => {
      const cols = db.prepare("PRAGMA table_info(memberships)").all() as { name: string }[];
      const names = cols.map((c) => c.name);
      expect(names).toEqual(
        expect.arrayContaining(["workspace_id", "user_id", "role", "created_at"]),
      );
    });

    it("collections has the expected columns including deleted flag", () => {
      const cols = db.prepare("PRAGMA table_info(collections)").all() as { name: string }[];
      const names = cols.map((c) => c.name);
      expect(names).toEqual(
        expect.arrayContaining([
          "id",
          "workspace_id",
          "name",
          "data",
          "version",
          "updated_at",
          "updated_by",
          "deleted",
        ]),
      );
    });
  });

  describe("indexes", () => {
    it("creates the expected indexes", () => {
      const rows = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all() as { name: string }[];
      const names = rows.map((r) => r.name);

      for (const expected of ["idx_collections_ws", "idx_environments_ws", "idx_folders_col"]) {
        expect(names).toContain(expected);
      }
    });
  });

  describe("pragmas", () => {
    it("enables WAL journal mode", () => {
      const result = db.pragma("journal_mode", { simple: true }) as string;
      expect(result.toLowerCase()).toBe("wal");
    });

    it("enables foreign keys", () => {
      const result = db.pragma("foreign_keys", { simple: true }) as number;
      expect(result).toBe(1);
    });
  });

  describe("constraints", () => {
    it("rejects memberships with an unknown role", () => {
      db.prepare("INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)").run(
        "u-1",
        "a@x",
        "A",
        1,
      );
      db.prepare(
        "INSERT INTO workspaces (id, name, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).run("ws-1", "W", "u-1", 1, 1);

      expect(() =>
        db
          .prepare(
            "INSERT INTO memberships (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)",
          )
          .run("ws-1", "u-1", "hacker", 1),
      ).toThrow(/CHECK/);
    });

    it("accepts the three valid roles", () => {
      db.prepare("INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)").run(
        "u-1",
        "a@x",
        "A",
        1,
      );
      db.prepare(
        "INSERT INTO workspaces (id, name, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).run("ws-1", "W", "u-1", 1, 1);

      for (const role of ["owner", "editor", "viewer"]) {
        expect(() =>
          db
            .prepare(
              "INSERT INTO memberships (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)",
            )
            .run("ws-1", `u-${role}`, role, 1),
        ).not.toThrow();
      }
    });

    it("enforces PRIMARY KEY uniqueness on memberships", () => {
      db.prepare("INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)").run(
        "u-1",
        "a@x",
        "A",
        1,
      );
      db.prepare(
        "INSERT INTO workspaces (id, name, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).run("ws-1", "W", "u-1", 1, 1);

      db.prepare(
        "INSERT INTO memberships (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)",
      ).run("ws-1", "u-1", "owner", 1);

      expect(() =>
        db
          .prepare(
            "INSERT INTO memberships (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)",
          )
          .run("ws-1", "u-1", "editor", 2),
      ).toThrow(/UNIQUE|PRIMARY KEY/);
    });

    it("enforces NOT NULL on users.email", () => {
      expect(() =>
        db
          .prepare("INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)")
          .run("u-1", null, "A", 1),
      ).toThrow(/NOT NULL/);
    });

    it("enforces NOT NULL on workspaces.owner_id", () => {
      expect(() =>
        db
          .prepare(
            "INSERT INTO workspaces (id, name, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
          )
          .run("ws-1", "W", null, 1, 1),
      ).toThrow(/NOT NULL/);
    });
  });

  describe("default values", () => {
    it("defaults collections.version to 1 and deleted to 0", () => {
      db.prepare("INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)").run(
        "u-1",
        "a@x",
        "A",
        1,
      );
      db.prepare(
        "INSERT INTO workspaces (id, name, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).run("ws-1", "W", "u-1", 1, 1);
      db.prepare(
        "INSERT INTO collections (id, workspace_id, name, data, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)",
      ).run("c-1", "ws-1", "C", "{}", 1, "u-1");

      const row = db
        .prepare("SELECT version, deleted FROM collections WHERE id = ?")
        .get("c-1") as { version: number; deleted: number };
      expect(row.version).toBe(1);
      expect(row.deleted).toBe(0);
    });
  });

  describe("round-trip", () => {
    it("can insert and read back a workspace", () => {
      db.prepare("INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)").run(
        "u-1",
        "owner@x",
        "Owner",
        1700000000,
      );
      db.prepare(
        "INSERT INTO workspaces (id, name, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).run("ws-1", "My Workspace", "u-1", 1700000000, 1700000001);

      const row = db.prepare("SELECT * FROM workspaces WHERE id = ?").get("ws-1") as {
        id: string;
        name: string;
        owner_id: string;
      };
      expect(row.id).toBe("ws-1");
      expect(row.name).toBe("My Workspace");
      expect(row.owner_id).toBe("u-1");
    });
  });
});

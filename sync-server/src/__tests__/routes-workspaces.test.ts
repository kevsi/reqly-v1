import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { createHmac } from "node:crypto";
import workspacesRoute from "../routes/workspaces.js";
import db from "../db.js";
import type { AuthContext } from "../auth.js";

function makeSessionCookie(
  userId: string,
  overrides: Partial<{ email: string; name: string }> = {},
): string {
  const secret = process.env.AUTH_SIGNING_SECRET!;
  const payload = {
    email: overrides.email ?? `${userId}@example.com`,
    name: overrides.name ?? userId,
    provider: "github",
    userId,
    expires: Date.now() + 60_000,
    ver: 0,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

function buildApp() {
  const app = new Hono<{ Variables: { auth: AuthContext } }>();
  app.route("/workspaces", workspacesRoute);
  return app;
}

const WS = "ws-explicit";
const USER_A = "user-a";
const USER_B = "user-b";

beforeEach(() => {
  process.env.AUTH_SIGNING_SECRET = "test-secret-do-not-use-in-prod";
  db.exec(`
    DELETE FROM activity_log; DELETE FROM folders;
    DELETE FROM environments;
    DELETE FROM collections;
    DELETE FROM activity_log; DELETE FROM memberships;
    DELETE FROM invitations;
    DELETE FROM workspaces;
    DELETE FROM users;
  `);
  db.prepare("INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)").run(
    USER_A,
    `${USER_A}@x`,
    "A",
    1,
  );
  db.prepare("INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)").run(
    USER_B,
    `${USER_B}@x`,
    "B",
    1,
  );
});

describe("routes/workspaces", () => {
  describe("authentication", () => {
    it("returns 401 when no cookie is provided", async () => {
      const app = buildApp();
      const res = await app.request(`/workspaces`);
      expect(res.status).toBe(401);
    });
  });

  describe("POST /", () => {
    it("creates a workspace and makes the user the owner", async () => {
      const app = buildApp();
      const cookie = makeSessionCookie(USER_A);
      const res = await app.request(`/workspaces`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `auth_session=${cookie}`,
        },
        body: JSON.stringify({ name: "My Team" }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        workspace: { id: string; name: string; ownerId: string };
      };
      expect(body.workspace.name).toBe("My Team");
      expect(body.workspace.ownerId).toBe(USER_A);

      // Verify membership was created
      const membership = db
        .prepare("SELECT role FROM memberships WHERE workspace_id = ? AND user_id = ?")
        .get(body.workspace.id, USER_A) as { role: string } | undefined;
      expect(membership?.role).toBe("owner");
    });

    it("upserts the user record on workspace creation", async () => {
      const app = buildApp();
      const cookie = makeSessionCookie(USER_A, { email: "alice@team.io", name: "Alice" });
      const res = await app.request(`/workspaces`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `auth_session=${cookie}`,
        },
        body: JSON.stringify({ name: "Workspace" }),
      });
      expect(res.status).toBe(200);

      const user = db.prepare("SELECT id, email, name FROM users WHERE id = ?").get(USER_A) as
        { id: string; email: string; name: string } | undefined;
      expect(user?.email).toBe("alice@team.io");
      expect(user?.name).toBe("Alice");
    });

    it("returns 4xx on invalid name (empty string)", async () => {
      const app = buildApp();
      const cookie = makeSessionCookie(USER_A);
      const res = await app.request(`/workspaces`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `auth_session=${cookie}`,
        },
        body: JSON.stringify({ name: "" }),
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe("GET /", () => {
    it("returns the list of workspaces the user belongs to", async () => {
      // Pre-create a workspace and membership for USER_A
      db.prepare(
        "INSERT INTO workspaces (id, name, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).run(WS, "Pre-existing", USER_A, 1, 2);
      db.prepare(
        "INSERT INTO memberships (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)",
      ).run(WS, USER_A, "owner", 1);

      const app = buildApp();
      const cookie = makeSessionCookie(USER_A);
      const res = await app.request(`/workspaces`, {
        headers: { cookie: `auth_session=${cookie}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { workspaces: Array<{ id: string; name: string }> };
      expect(body.workspaces).toHaveLength(1);
      expect(body.workspaces[0].id).toBe(WS);
      expect(body.workspaces[0].name).toBe("Pre-existing");
    });

    it("does not return workspaces the user is not a member of", async () => {
      db.prepare(
        "INSERT INTO workspaces (id, name, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).run(WS, "Other team", USER_B, 1, 1);
      db.prepare(
        "INSERT INTO memberships (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)",
      ).run(WS, USER_B, "owner", 1);

      const app = buildApp();
      const cookie = makeSessionCookie(USER_A);
      const res = await app.request(`/workspaces`, {
        headers: { cookie: `auth_session=${cookie}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { workspaces: unknown[] };
      expect(body.workspaces).toHaveLength(0);
    });
  });

  describe("POST /:id/invitations", () => {
    beforeEach(() => {
      db.prepare(
        "INSERT INTO workspaces (id, name, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).run(WS, "W", USER_A, 1, 1);
      db.prepare(
        "INSERT INTO memberships (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)",
      ).run(WS, USER_A, "owner", 1);
    });

    it("lets the owner create an invitation token", async () => {
      const app = buildApp();
      const cookie = makeSessionCookie(USER_A);
      const res = await app.request(`/workspaces/${WS}/invitations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `auth_session=${cookie}`,
        },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { token: string; expiresAt: number; role: string };
      expect(body.token).toMatch(/^inv-/);
      expect(body.role).toBe("editor");
      expect(body.expiresAt).toBeGreaterThan(Date.now());
    });

    it("logs only a fingerprint in activity_log, never the raw invitation token", async () => {
      const app = buildApp();
      const cookie = makeSessionCookie(USER_A);
      const res = await app.request(`/workspaces/${WS}/invitations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `auth_session=${cookie}`,
        },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { token: string };

      const entry = db
        .prepare(
          "SELECT entity_id FROM activity_log WHERE action = 'invitation.created' ORDER BY id DESC LIMIT 1",
        )
        .get() as { entity_id: string } | undefined;
      expect(entry).toBeDefined();
      // The raw token must never appear in the activity feed (viewers can read it).
      expect(entry!.entity_id).not.toBe(body.token);
      expect(entry!.entity_id).not.toContain(body.token);
      // Only the short fingerprint is logged: `inv-…` + last 8 chars of the token.
      expect(entry!.entity_id).toBe(`inv-…${body.token.slice(-8)}`);
    });

    it("rejects non-owners with 403", async () => {
      // Make USER_B an editor
      db.prepare(
        "INSERT INTO memberships (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)",
      ).run(WS, USER_B, "editor", 1);

      const app = buildApp();
      const cookie = makeSessionCookie(USER_B);
      const res = await app.request(`/workspaces/${WS}/invitations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `auth_session=${cookie}`,
        },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("owner");
    });

    it("rejects non-members with 403", async () => {
      const app = buildApp();
      db.prepare("INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)").run(
        "intruder",
        "intruder@example.com",
        "Intruder",
        1,
      );
      const cookie = makeSessionCookie("intruder");
      const res = await app.request(`/workspaces/${WS}/invitations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `auth_session=${cookie}`,
        },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(403);
    });
  });

  describe("DELETE /:id", () => {
    beforeEach(() => {
      db.prepare(
        "INSERT INTO workspaces (id, name, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).run(WS, "W", USER_A, 1, 1);
      db.prepare(
        "INSERT INTO memberships (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)",
      ).run(WS, USER_A, "owner", 1);
    });

    it("cascades child collections/environments/folders on delete (FK NO ACTION)", async () => {
      // Seed a collection, an environment, and a folder under the workspace.
      db.prepare(
        "INSERT INTO collections (id, workspace_id, name, data, version, updated_at, updated_by, deleted) VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
      ).run("col-1", WS, "Col", JSON.stringify({ name: "Col" }), 1, 1, USER_A);
      db.prepare(
        "INSERT INTO environments (id, workspace_id, name, data, version, updated_at, updated_by, deleted) VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
      ).run("env-1", WS, "Env", JSON.stringify({ name: "Env" }), 1, 1, USER_A);
      db.prepare(
        "INSERT INTO folders (id, collection_id, name, data, version, updated_at, updated_by, deleted) VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
      ).run("fol-1", "col-1", "Fol", JSON.stringify({ name: "Fol" }), 1, 1, USER_A);

      const app = buildApp();
      const cookie = makeSessionCookie(USER_A);
      const res = await app.request(`/workspaces/${WS}`, {
        method: "DELETE",
        headers: { cookie: `auth_session=${cookie}` },
      });
      expect(res.status).toBe(200);

      // Workspace and all children must be gone (no orphaned rows, no FK error).
      expect(db.prepare("SELECT 1 FROM workspaces WHERE id = ?").get(WS)).toBeUndefined();
      expect(db.prepare("SELECT 1 FROM collections WHERE id = ?").get("col-1")).toBeUndefined();
      expect(db.prepare("SELECT 1 FROM environments WHERE id = ?").get("env-1")).toBeUndefined();
      expect(db.prepare("SELECT 1 FROM folders WHERE id = ?").get("fol-1")).toBeUndefined();
    });

    it("deletes a workspace that has activity_log entries (FK cascade)", async () => {
      // Regression (audit P1): activity_log references the workspace; without
      // purging it, any workspace that ever logged an event could not be
      // deleted (FOREIGN KEY constraint failed → 500).
      db.prepare(
        "INSERT INTO activity_log (workspace_id, actor_id, action, created_at) VALUES (?, ?, ?, ?)",
      ).run(WS, USER_A, "resource.created", Date.now());

      const app = buildApp();
      const cookie = makeSessionCookie(USER_A);
      const res = await app.request(`/workspaces/${WS}`, {
        method: "DELETE",
        headers: { cookie: `auth_session=${cookie}` },
      });
      expect(res.status).toBe(200);
      expect(db.prepare("SELECT 1 FROM workspaces WHERE id = ?").get(WS)).toBeUndefined();
      expect(
        db.prepare("SELECT COUNT(*) AS n FROM activity_log WHERE workspace_id = ?").get(WS),
      ).toEqual({ n: 0 });
    });

    it("rejects non-owner with 403", async () => {
      db.prepare(
        "INSERT INTO memberships (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)",
      ).run(WS, USER_B, "editor", 1);

      const app = buildApp();
      const cookie = makeSessionCookie(USER_B);
      const res = await app.request(`/workspaces/${WS}`, {
        method: "DELETE",
        headers: { cookie: `auth_session=${cookie}` },
      });
      expect(res.status).toBe(403);
    });

    it("returns 404 for a missing workspace", async () => {
      const app = buildApp();
      const cookie = makeSessionCookie(USER_A);
      const res = await app.request(`/workspaces/nope`, {
        method: "DELETE",
        headers: { cookie: `auth_session=${cookie}` },
      });
      expect(res.status).toBe(404);
    });
  });
});

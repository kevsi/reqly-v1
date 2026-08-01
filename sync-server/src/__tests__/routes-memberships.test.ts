import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { createHmac } from "node:crypto";
import membershipsRoute from "../routes/memberships.js";
import db from "../db.js";
import type { AuthContext } from "../auth.js";

function makeSessionCookie(userId: string): string {
  const secret = process.env.AUTH_SIGNING_SECRET!;
  const payload = {
    email: `${userId}@example.com`,
    name: userId,
    provider: "github",
    userId,
    expires: Date.now() + 60_000,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

function buildApp() {
  const app = new Hono<{ Variables: { auth: AuthContext } }>();
  app.route("/memberships", membershipsRoute);
  return app;
}

const WS = "ws-join";
const OWNER = "user-owner";
const JOINER = "user-joiner";

beforeEach(() => {
  process.env.AUTH_SIGNING_SECRET = "test-secret-do-not-use-in-prod";
  db.exec(`
    DELETE FROM folders;
    DELETE FROM environments;
    DELETE FROM collections;
    DELETE FROM memberships;
    DELETE FROM invitations;
    DELETE FROM workspaces;
    DELETE FROM users;
  `);
  db.prepare("INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)").run(
    OWNER,
    `${OWNER}@x`,
    "Owner",
    1,
  );
  db.prepare(
    "INSERT INTO workspaces (id, name, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).run(WS, "W", OWNER, 1, 1);
  db.prepare(
    "INSERT INTO memberships (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)",
  ).run(WS, OWNER, "owner", 1);
});

describe("routes/memberships", () => {
  describe("authentication", () => {
    it("returns 401 when no cookie is provided", async () => {
      const app = buildApp();
      const res = await app.request(`/memberships`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "x" }),
      });
      expect(res.status).toBe(401);
    });
  });

  describe("POST /", () => {
    it("lets a user join a workspace using a valid invitation token", async () => {
      const token = "inv-valid-123";
      const expiresAt = Date.now() + 60_000;
      db.prepare(
        "INSERT INTO invitations (token, workspace_id, role, created_at, expires_at, created_by) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(token, WS, "editor", Date.now(), expiresAt, OWNER);

      const app = buildApp();
      const cookie = makeSessionCookie(JOINER);
      const res = await app.request(`/memberships`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `auth_session=${cookie}`,
        },
        body: JSON.stringify({ token }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { workspace: { id: string }; role: string };
      expect(body.workspace.id).toBe(WS);
      expect(body.role).toBe("editor");

      // Membership row was created
      const membership = db
        .prepare("SELECT role FROM memberships WHERE workspace_id = ? AND user_id = ?")
        .get(WS, JOINER) as { role: string } | undefined;
      expect(membership?.role).toBe("editor");
    });

    it("returns 400 for an unknown token", async () => {
      const app = buildApp();
      const cookie = makeSessionCookie(JOINER);
      const res = await app.request(`/memberships`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `auth_session=${cookie}`,
        },
        body: JSON.stringify({ token: "does-not-exist" }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/Invalid|expired/i);
    });

    it("returns 400 for an expired token", async () => {
      const token = "inv-expired-1";
      const pastExpiry = Date.now() - 1_000;
      db.prepare(
        "INSERT INTO invitations (token, workspace_id, role, created_at, expires_at, created_by) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(token, WS, "editor", Date.now() - 60_000, pastExpiry, OWNER);

      const app = buildApp();
      const cookie = makeSessionCookie(JOINER);
      const res = await app.request(`/memberships`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `auth_session=${cookie}`,
        },
        body: JSON.stringify({ token }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/expired/i);
    });

    it("does not duplicate the membership if the user joins twice", async () => {
      const token = "inv-double";
      db.prepare(
        "INSERT INTO invitations (token, workspace_id, role, created_at, expires_at, created_by) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(token, WS, "editor", Date.now(), Date.now() + 60_000, OWNER);

      const app = buildApp();
      const cookie = makeSessionCookie(JOINER);
      // First join
      await app.request(`/memberships`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: `auth_session=${cookie}` },
        body: JSON.stringify({ token }),
      });
      // Second join with the same token
      const res2 = await app.request(`/memberships`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: `auth_session=${cookie}` },
        body: JSON.stringify({ token }),
      });
      expect(res2.status).toBe(200);

      const rows = db
        .prepare("SELECT user_id FROM memberships WHERE workspace_id = ? AND user_id = ?")
        .all(WS, JOINER);
      expect(rows).toHaveLength(1);
    });

    it("returns 4xx for a malformed body (missing token)", async () => {
      const app = buildApp();
      const cookie = makeSessionCookie(JOINER);
      const res = await app.request(`/memberships`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `auth_session=${cookie}`,
        },
        body: JSON.stringify({}),
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });
});

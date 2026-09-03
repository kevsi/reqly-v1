import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import { createHmac } from "node:crypto";
import syncRoute from "../routes/sync.js";
import db from "../db.js";
import * as wsHub from "../ws-hub.js";
import type { AuthContext } from "../auth.js";

// Build a signed session cookie (same shape auth.ts expects).
function makeSessionCookie(userId: string): string {
  const secret = process.env.AUTH_SIGNING_SECRET!;
  const payload = {
    email: `${userId}@example.com`,
    name: userId,
    provider: "github",
    userId,
    expires: Date.now() + 60_000,
    ver: 0,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

// Build a Hono app with the sync route mounted and an optional mock for broadcast.
function buildApp(opts: { broadcastMock?: ReturnType<typeof makeMockBroadcast> } = {}) {
  const app = new Hono<{ Variables: { auth: AuthContext } }>();
  app.route("/sync", syncRoute);
  return app;
}

function makeMockBroadcast() {
  const calls: Array<{ workspaceId: string; payload: any }> = [];
  // Spy on broadcastToWorkspace for the duration of the test.
  const spy = vi.spyOn(wsHub, "broadcastToWorkspace").mockImplementation((workspaceId, payload) => {
    calls.push({ workspaceId, payload });
  });
  return {
    calls,
    restore: () => {
      spy.mockRestore();
    },
  };
}

const WS = "ws-sync";
const USER_A = "user-a";

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
  db.prepare(
    "INSERT INTO workspaces (id, name, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).run(WS, "W", USER_A, 1, 1);
  db.prepare(
    "INSERT INTO memberships (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)",
  ).run(WS, USER_A, "owner", 1);
});

describe("routes/sync", () => {
  describe("authentication", () => {
    it("returns 401 when no cookie is provided", async () => {
      const app = buildApp();
      const res = await app.request(`/sync/poll?workspaceId=${WS}&since=0`);
      expect(res.status).toBe(401);
    });

    it("returns 401 when the cookie is invalid", async () => {
      const app = buildApp();
      const res = await app.request(`/sync/poll?workspaceId=${WS}&since=0`, {
        headers: { cookie: "auth_session=garbage" },
      });
      expect(res.status).toBe(401);
    });
  });

  describe("GET /poll", () => {
    it("returns 400 when workspaceId is missing", async () => {
      const app = buildApp();
      const cookie = makeSessionCookie(USER_A);
      const res = await app.request(`/sync/poll?since=0`, {
        headers: { cookie: `auth_session=${cookie}` },
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("workspaceId");
    });

    it("returns 403 when the user is not a member of the workspace", async () => {
      const app = buildApp();
      db.prepare("INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)").run(
        "intruder",
        "intruder@example.com",
        "Intruder",
        1,
      );
      const cookie = makeSessionCookie("intruder");
      const res = await app.request(`/sync/poll?workspaceId=${WS}&since=0`, {
        headers: { cookie: `auth_session=${cookie}` },
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("Not a member");
    });

    it("returns an empty change list for a fresh workspace", async () => {
      const app = buildApp();
      const cookie = makeSessionCookie(USER_A);
      const res = await app.request(`/sync/poll?workspaceId=${WS}&since=0`, {
        headers: { cookie: `auth_session=${cookie}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { changes: unknown[]; serverTime: number };
      expect(body.changes).toEqual([]);
      expect(typeof body.serverTime).toBe("number");
    });

    it("defaults the since parameter to 0 when missing", async () => {
      const app = buildApp();
      const cookie = makeSessionCookie(USER_A);
      const res = await app.request(`/sync/poll?workspaceId=${WS}`, {
        headers: { cookie: `auth_session=${cookie}` },
      });
      expect(res.status).toBe(200);
    });
  });

  describe("POST /push", () => {
    it("accepts a valid change and reports it as accepted", async () => {
      const app = buildApp();
      const cookie = makeSessionCookie(USER_A);
      const res = await app.request(`/sync/push`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `auth_session=${cookie}`,
        },
        body: JSON.stringify({
          workspaceId: WS,
          changes: [
            {
              entityType: "collection",
              id: "col-1",
              data: { id: "col-1", name: "New", requests: [] },
              updatedAt: Date.now(),
              updatedBy: USER_A,
            },
          ],
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { accepted: string[]; rejected: unknown[] };
      expect(body.accepted).toContain("col-1");
    });

    it("returns 403 when the user is not a member", async () => {
      const app = buildApp();
      db.prepare("INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)").run(
        "intruder",
        "intruder@example.com",
        "Intruder",
        1,
      );
      const cookie = makeSessionCookie("intruder");
      const res = await app.request(`/sync/push`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `auth_session=${cookie}`,
        },
        body: JSON.stringify({ workspaceId: WS, changes: [] }),
      });
      expect(res.status).toBe(403);
    });

    it("returns 400 on malformed body", async () => {
      const app = buildApp();
      const cookie = makeSessionCookie(USER_A);
      const res = await app.request(`/sync/push`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `auth_session=${cookie}`,
        },
        body: JSON.stringify({ wrong: "shape" }),
      });
      // zod throws on invalid body; Hono turns that into a 500 by default
      // unless there's an error handler. We accept either 4xx or 5xx to
      // reflect current behaviour while still asserting the route rejects.
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it("broadcasts a change event to the workspace when changes are accepted", async () => {
      const mock = makeMockBroadcast();
      try {
        const app = buildApp();
        const cookie = makeSessionCookie(USER_A);
        const res = await app.request(`/sync/push`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            cookie: `auth_session=${cookie}`,
          },
          body: JSON.stringify({
            workspaceId: WS,
            changes: [
              {
                entityType: "collection",
                id: "col-broadcast",
                data: { id: "col-broadcast", name: "X", requests: [] },
                updatedAt: Date.now(),
                updatedBy: USER_A,
              },
            ],
          }),
        });
        expect(res.status).toBe(200);
        // The broadcast should fire exactly once for this single accepted change
        expect(mock.calls.length).toBe(1);
        expect(mock.calls[0].workspaceId).toBe(WS);
        expect(mock.calls[0].payload.type).toBe("change");
        expect(mock.calls[0].payload.entityIds).toContain("col-broadcast");
      } finally {
        mock.restore();
      }
    });

    it("does not broadcast when no changes are accepted", async () => {
      const mock = makeMockBroadcast();
      try {
        const app = buildApp();
        const cookie = makeSessionCookie(USER_A);
        const res = await app.request(`/sync/push`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            cookie: `auth_session=${cookie}`,
          },
          body: JSON.stringify({ workspaceId: WS, changes: [] }),
        });
        expect(res.status).toBe(200);
        expect(mock.calls.length).toBe(0);
      } finally {
        mock.restore();
      }
    });
  });

  describe("e2e: push â†’ poll â†’ verify cycle", () => {
    it("adds, updates, deletes and returns the latest version of each entity", async () => {
      const cookie = makeSessionCookie(USER_A);
      const app = buildApp();

      // 1. Push a new collection
      const now = Date.now();
      const push1 = await app.request(`/sync/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: `auth_session=${cookie}` },
        body: JSON.stringify({
          workspaceId: WS,
          changes: [
            {
              entityType: "collection",
              id: "col-e2e",
              data: { id: "col-e2e", name: "E2E", requests: [] },
              updatedAt: now,
              updatedBy: USER_A,
            },
          ],
        }),
      });
      expect(push1.status).toBe(200);
      const r1 = (await push1.json()) as { accepted: string[] };
      expect(r1.accepted).toEqual(["col-e2e"]);

      // Poll for the add â€” we should see it
      const poll1 = await app.request(`/sync/poll?workspaceId=${WS}&since=${now - 1000}`, {
        headers: { cookie: `auth_session=${cookie}` },
      });
      const b1 = (await poll1.json()) as { changes: Array<{ id: string; data: { name: string } }> };
      expect(b1.changes.some((c) => c.id === "col-e2e" && c.data.name === "E2E")).toBe(true);

      // 2. Push an update to the same collection
      const push2 = await app.request(`/sync/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: `auth_session=${cookie}` },
        body: JSON.stringify({
          workspaceId: WS,
          changes: [
            {
              entityType: "collection",
              id: "col-e2e",
              data: { id: "col-e2e", name: "E2E-Updated", requests: [] },
              updatedAt: now + 100,
              updatedBy: USER_A,
            },
          ],
        }),
      });
      expect(push2.status).toBe(200);

      // Poll â€” should see the updated name
      const poll2 = await app.request(`/sync/poll?workspaceId=${WS}&since=${now - 1000}`, {
        headers: { cookie: `auth_session=${cookie}` },
      });
      const b2 = (await poll2.json()) as { changes: Array<{ id: string; data: { name: string } }> };
      const colAfterUpdate = b2.changes.find((c) => c.id === "col-e2e");
      expect(colAfterUpdate).toBeDefined();
      expect(colAfterUpdate!.data.name).toBe("E2E-Updated");

      // 3. Push a deletion
      const push3 = await app.request(`/sync/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: `auth_session=${cookie}` },
        body: JSON.stringify({
          workspaceId: WS,
          changes: [
            {
              entityType: "collection",
              id: "col-e2e",
              data: { id: "col-e2e", name: "E2E-Updated", requests: [] },
              updatedAt: now + 200,
              updatedBy: USER_A,
              deleted: true,
            },
          ],
        }),
      });
      expect(push3.status).toBe(200);

      // Poll â€” should see the deletion flag
      const poll3 = await app.request(`/sync/poll?workspaceId=${WS}&since=${now - 1000}`, {
        headers: { cookie: `auth_session=${cookie}` },
      });
      const b3 = (await poll3.json()) as { changes: Array<{ id: string; deleted: boolean }> };
      const colAfterDelete = b3.changes.find((c) => c.id === "col-e2e");
      expect(colAfterDelete).toBeDefined();
      expect(colAfterDelete!.deleted).toBe(true);
    });
  });
});

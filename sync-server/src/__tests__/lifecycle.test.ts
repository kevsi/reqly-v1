import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import authRoute from "../routes/auth.js";
import workspacesRoute from "../routes/workspaces.js";
import membershipsRoute from "../routes/memberships.js";
import syncRoute from "../routes/sync.js";
import db from "../db.js";
import { _testCodes } from "../routes/auth.js";

function buildApp() {
  const app = new Hono();
  app.route("/api/auth", authRoute);
  app.route("/api/workspaces", workspacesRoute);
  app.route("/api/memberships", membershipsRoute);
  app.route("/api/sync", syncRoute);
  return app;
}

type App = ReturnType<typeof buildApp>;

async function signupAndLogin(app: App, email: string): Promise<string> {
  await app.request("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "supersecret" }),
  });
  const code = _testCodes.get(`verify:${email}`);
  if (!code) throw new Error("no code for " + email);
  const res = await app.request("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code }),
  });
  const { token } = (await res.json()) as { token: string };
  return token;
}

const authHeader = (token: string) => ({ Authorization: `Bearer ${token}` });

async function createWorkspace(app: App, token: string, name: string): Promise<string> {
  const res = await app.request("/api/workspaces", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader(token) },
    body: JSON.stringify({ name }),
  });
  const body = (await res.json()) as { workspace?: { id?: string }; id?: string };
  return (body.workspace?.id ?? body.id)!;
}

async function userId(app: App, token: string): Promise<string> {
  const res = await app.request("/api/auth/me", { headers: authHeader(token) });
  const body = (await res.json()) as { user: { id: string } };
  return body.user.id;
}

beforeEach(() => {
  process.env.AUTH_SIGNING_SECRET = "test-secret-do-not-use-in-prod";
  db.exec("DELETE FROM activity_log;");
  db.exec("DELETE FROM folders; DELETE FROM environments; DELETE FROM collections;");
  db.exec(
    "DELETE FROM invitations; DELETE FROM memberships; DELETE FROM workspaces; DELETE FROM users;",
  );
  _testCodes.clear();
});

describe("ownership transfer (spec §2.3)", () => {
  it("swaps roles atomically and logs the event", async () => {
    const app = buildApp();
    const aliceToken = await signupAndLogin(app, "alice@tr.test");
    const bobToken = await signupAndLogin(app, "bob@tr.test");
    const wsId = await createWorkspace(app, aliceToken, "WS");
    const bobId = await userId(app, bobToken);

    // Bob must be a member first — invite him as editor.
    const inv = await app.request(`/api/workspaces/${wsId}/invitations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader(aliceToken) },
      body: JSON.stringify({}),
    });
    const { token } = (await inv.json()) as { token: string };
    await app.request("/api/memberships", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader(bobToken) },
      body: JSON.stringify({ token }),
    });

    const res = await app.request(`/api/workspaces/${wsId}/transfer`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader(aliceToken) },
      body: JSON.stringify({ newOwnerId: bobId }),
    });
    expect(res.status).toBe(200);

    // Workspace owner flipped…
    const ws = db.prepare("SELECT owner_id FROM workspaces WHERE id = ?").get(wsId) as {
      owner_id: string;
    };
    expect(ws.owner_id).toBe(bobId);
    // …and membership roles swapped.
    const roles = db
      .prepare("SELECT user_id, role FROM memberships WHERE workspace_id = ?")
      .all(wsId) as Array<{ user_id: string; role: string }>;
    expect(roles.find((r) => r.user_id === bobId)?.role).toBe("owner");
    expect(roles.find((r) => r.user_id !== bobId)?.role).toBe("editor");

    // Old owner can no longer transfer (not the owner anymore).
    const again = await app.request(`/api/workspaces/${wsId}/transfer`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader(aliceToken) },
      body: JSON.stringify({ newOwnerId: bobId }),
    });
    expect(again.status).toBe(403);

    // Activity log recorded it.
    const activity = await app.request(`/api/workspaces/${wsId}/activity`, {
      headers: authHeader(bobToken),
    });
    const acts = ((await activity.json()) as { activity: Array<{ action: string }> }).activity;
    expect(acts.some((a) => a.action === "ownership.transferred")).toBe(true);
  });

  it("refuses transfer to a non-member and from a non-owner", async () => {
    const app = buildApp();
    const aliceToken = await signupAndLogin(app, "a3@tr.test");
    const outsiderToken = await signupAndLogin(app, "o3@tr.test");
    const wsId = await createWorkspace(app, aliceToken, "WS");
    const outsiderId = await userId(app, outsiderToken);

    const badTarget = await app.request(`/api/workspaces/${wsId}/transfer`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader(aliceToken) },
      body: JSON.stringify({ newOwnerId: outsiderId }),
    });
    expect(badTarget.status).toBe(400);

    const notOwner = await app.request(`/api/workspaces/${wsId}/transfer`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader(outsiderToken) },
      body: JSON.stringify({ newOwnerId: outsiderId }),
    });
    expect(notOwner.status).toBe(403);
  });
});

describe("created_by provenance (spec §5.1)", () => {
  it("sets created_by on creation and never overwrites it on later updates", async () => {
    const app = buildApp();
    const aliceToken = await signupAndLogin(app, "prov-a@pr.test");
    const wsId = await createWorkspace(app, aliceToken, "WS");

    await app.request("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader(aliceToken) },
      body: JSON.stringify({
        workspaceId: wsId,
        changes: [
          {
            entityType: "collection",
            id: "col-prov",
            data: { name: "Original" },
            updatedAt: 1000,
            updatedBy: "alice@pr.test",
          },
        ],
      }),
    });

    const row = db
      .prepare("SELECT created_by, updated_by FROM collections WHERE id = 'col-prov'")
      .get() as { created_by: string | null; updated_by: string };
    expect(row.created_by).toBeTruthy();

    // A different member updates it — created_by must stay untouched.
    await app.request("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader(aliceToken) },
      body: JSON.stringify({
        workspaceId: wsId,
        changes: [
          {
            entityType: "collection",
            id: "col-prov",
            data: { name: "Edited" },
            updatedAt: Date.now(),
            updatedBy: "someone-else-id",
          },
        ],
      }),
    });
    const after = db
      .prepare("SELECT created_by, updated_by FROM collections WHERE id = 'col-prov'")
      .get() as { created_by: string | null; updated_by: string };
    expect(after.created_by).toBe(row.created_by);
  });
});

describe("activity log (spec §5.2)", () => {
  it("records resource create/delete through pushes and serves them to members only", async () => {
    const app = buildApp();
    const aliceToken = await signupAndLogin(app, "act@al.test");
    const strangerToken = await signupAndLogin(app, "str@al.test");
    const wsId = await createWorkspace(app, aliceToken, "WS");

    await app.request("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader(aliceToken) },
      body: JSON.stringify({
        workspaceId: wsId,
        changes: [
          {
            entityType: "collection",
            id: "col-log",
            data: { name: "Logged" },
            updatedAt: Date.now(),
            updatedBy: "act@al.test",
          },
        ],
      }),
    });
    await app.request("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader(aliceToken) },
      body: JSON.stringify({
        workspaceId: wsId,
        changes: [
          {
            entityType: "collection",
            id: "col-log",
            data: {},
            deleted: true,
            updatedAt: Date.now() + 10,
            baseVersion: 1,
            updatedBy: "act@al.test",
          },
        ],
      }),
    });

    const res = await app.request(`/api/workspaces/${wsId}/activity`, {
      headers: authHeader(aliceToken),
    });
    expect(res.status).toBe(200);
    const acts = ((await res.json()) as { activity: Array<{ action: string }> }).activity;
    const actions = acts.map((a) => a.action);
    expect(actions).toContain("resource.created");
    expect(actions).toContain("resource.deleted");
    expect(actions[0]).toBe("resource.deleted"); // newest first

    // Non-members cannot read the feed.
    const denied = await app.request(`/api/workspaces/${wsId}/activity`, {
      headers: authHeader(strangerToken),
    });
    expect(denied.status).toBe(403);
  });
});

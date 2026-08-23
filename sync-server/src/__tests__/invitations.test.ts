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

async function invite(app: App, token: string, wsId: string, body: unknown) {
  return app.request(`/api/workspaces/${wsId}/invitations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader(token) },
    body: JSON.stringify(body),
  });
}

async function join(app: App, token: string, inviteToken: string) {
  return app.request("/api/memberships", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader(token) },
    body: JSON.stringify({ token: inviteToken }),
  });
}

beforeEach(() => {
  process.env.AUTH_SIGNING_SECRET = "test-secret-do-not-use-in-prod";
  db.exec(
    "DELETE FROM activity_log; DELETE FROM folders; DELETE FROM environments; DELETE FROM collections;",
  );
  db.exec(
    "DELETE FROM invitations; DELETE FROM activity_log; DELETE FROM memberships; DELETE FROM workspaces; DELETE FROM users;",
  );
  _testCodes.clear();
});

describe("invitations â€” role choice (spec §4.1)", () => {
  it("defaults to editor for legacy empty-body clients", async () => {
    const app = buildApp();
    const alice = await signupAndLogin(app, "alice@inv.test");
    const bob = await signupAndLogin(app, "bob@inv.test");
    const wsId = await createWorkspace(app, alice, "WS");

    const inv = await invite(app, alice, wsId, {});
    expect(inv.status).toBe(200);
    const { token, role } = (await inv.json()) as { token: string; role: string };
    expect(role).toBe("editor");

    const joined = await join(app, bob, token);
    expect(joined.status).toBe(200);
    const joinedBody = (await joined.json()) as { role: string };
    expect(joinedBody.role).toBe("editor");
  });

  it("lets the owner invite a viewer, who cannot push changes afterwards", async () => {
    const app = buildApp();
    const alice = await signupAndLogin(app, "owner@inv.test");
    const carol = await signupAndLogin(app, "carol@inv.test");
    const wsId = await createWorkspace(app, alice, "WS");

    const inv = await invite(app, alice, wsId, { role: "viewer" });
    expect(inv.status).toBe(200);
    const { token, role } = (await inv.json()) as { token: string; role: string };
    expect(role).toBe("viewer");

    const joined = await join(app, carol, token);
    const joinedBody = (await joined.json()) as { role: string };
    expect(joinedBody.role).toBe("viewer");

    // Server-side RBAC: the viewer must not be able to mutate anything.
    const push = await app.request("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader(carol) },
      body: JSON.stringify({
        workspaceId: wsId,
        changes: [
          {
            entityType: "collection",
            id: "col-x",
            data: { name: "Nope" },
            updatedAt: Date.now(),
            updatedBy: "carol@inv.test",
          },
        ],
      }),
    });
    expect(push.status).toBe(403);
    const pushBody = (await push.json()) as { error: string };
    expect(pushBody.error).toMatch(/viewer/i);

    // â€¦and rejects non-editor invitation roles outright.
    const badRole = await invite(app, alice, wsId, { role: "owner" });
    expect(badRole.status).toBe(400);
  });

  it("rejects invitation creation by a non-owner", async () => {
    const app = buildApp();
    const alice = await signupAndLogin(app, "own@inv.test");
    const bob = await signupAndLogin(app, "not-own@inv.test");
    const wsId = await createWorkspace(app, alice, "WS");

    const res = await invite(app, bob, wsId, {});
    expect(res.status).toBe(403);
  });
});

describe("invitations â€” single use (spec §6)", () => {
  it("consumes the token on first join and refuses subsequent joins", async () => {
    const app = buildApp();
    const alice = await signupAndLogin(app, "a2@inv.test");
    const bob = await signupAndLogin(app, "b2@inv.test");
    const dave = await signupAndLogin(app, "d2@inv.test");
    const wsId = await createWorkspace(app, alice, "WS");

    const inv = await invite(app, alice, wsId, {});
    const { token } = (await inv.json()) as { token: string };

    const first = await join(app, bob, token);
    expect(first.status).toBe(200);

    // Second user tries the SAME token â†’ refused.
    const second = await join(app, dave, token);
    expect(second.status).toBe(400);
    const secondBody = (await second.json()) as { error: string };
    expect(secondBody.error).toMatch(/utilisée/i);

    // Even the SAME user rejoining is refused.
    const again = await join(app, bob, token);
    expect(again.status).toBe(400);
  });
});

describe("invitations â€” anti-spam cap (spec §6)", () => {
  it("rate-limits invitation creation per user per hour", async () => {
    const app = buildApp();
    const alice = await signupAndLogin(app, "spammer@inv.test");
    const wsId = await createWorkspace(app, alice, "WS");

    let lastStatus = 0;
    let got429 = false;
    for (let i = 0; i < 12; i++) {
      const res = await invite(app, alice, wsId, {});
      lastStatus = res.status;
      if (res.status === 429) got429 = true;
    }
    expect(lastStatus).toBe(429);
    expect(got429).toBe(true);
  });
});

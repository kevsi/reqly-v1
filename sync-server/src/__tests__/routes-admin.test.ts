import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import admin, { requireAdminToken } from "../routes/admin.js";
import db from "../db.js";

const ADMIN = "test-admin-secret";
process.env.ADMIN_TOKEN = ADMIN;

function app() {
  const a = new Hono();
  a.route("/api/admin", admin);
  return a;
}

const auth = { Authorization: `Bearer ${ADMIN}` };

beforeEach(() => {
  db.exec(`DELETE FROM activity_log; DELETE FROM memberships; DELETE FROM invitations;
           DELETE FROM collections; DELETE FROM workspaces; DELETE FROM users;`);
});

function seedUser(
  id: string,
  email: string,
  opts: { oauth?: boolean; disabled?: number; verified?: number } = {},
) {
  db.prepare(
    `INSERT INTO users (id, email, name, password_hash, verified, created_at, token_version, disabled)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
  ).run(
    id,
    email,
    email.split("@")[0],
    opts.oauth ? null : "hash",
    opts.verified ?? 0,
    Date.now(),
    opts.disabled ?? 0,
  );
}

describe("admin auth", () => {
  it("refuses without / wrong / unset token", async () => {
    const a = app();
    expect((await a.request("/api/admin/stats")).status).toBe(401);
    expect(
      (await a.request("/api/admin/stats", { headers: { Authorization: "Bearer nope" } })).status,
    ).toBe(401);

    process.env.ADMIN_TOKEN = "";
    const res = await a.request("/api/admin/stats", { headers: auth });
    expect(res.status).toBe(401);
    process.env.ADMIN_TOKEN = ADMIN;
  });
});

describe("admin endpoints", () => {
  it("stats counts users/workspaces/invitations", async () => {
    seedUser("u1", "a@x.io", { verified: 1 });
    seedUser("u2", "b@x.io", { oauth: true });
    seedUser("u3", "c@x.io", { disabled: 1 });
    db.prepare(
      `INSERT INTO workspaces (id, name, owner_id, created_at, updated_at) VALUES ('w1','WS','u1',?,?)`,
    ).run(Date.now(), Date.now());
    db.prepare(
      `INSERT INTO memberships (workspace_id, user_id, role, created_at) VALUES ('w1','u1','owner',?)`,
    ).run(Date.now());

    const res = await app().request("/api/admin/stats", { headers: auth });
    const body = (await res.json()) as Record<string, number>;
    expect(body.users).toBe(3);
    expect(body.oauthUsers).toBe(1);
    expect(body.disabledUsers).toBe(1);
    expect(body.workspaces).toBe(1);
    expect(body.memberships).toBe(1);
  });

  it("lists + searches users with workspace_count", async () => {
    seedUser("u1", "alice@example.com");
    seedUser("u2", "bob@example.com");

    const res = await app().request("/api/admin/users?query=ali", { headers: auth });
    const body = (await res.json()) as {
      users: Array<{ email: string; provider: string }>;
      total: number;
    };
    expect(body.total).toBe(1);
    expect(body.users[0].email).toBe("alice@example.com");
    expect(body.users[0].provider).toBe("password");
  });

  it("disable bumps token_version and enable clears flag", async () => {
    seedUser("u1", "a@x.io");
    await app().request("/api/admin/users/u1/disable", { method: "POST", headers: auth });
    const row = db.prepare(`SELECT disabled, token_version FROM users WHERE id='u1'`).get() as {
      disabled: number;
      token_version: number;
    };
    expect(row.disabled).toBe(1);
    expect(row.token_version).toBe(1); // sessions killed

    await app().request("/api/admin/users/u1/enable", { method: "POST", headers: auth });
    expect(
      (db.prepare(`SELECT disabled FROM users WHERE id='u1'`).get() as { disabled: number })
        .disabled,
    ).toBe(0);
  });

  it("revoke-sessions 404s unknown user", async () => {
    const res = await app().request("/api/admin/users/nope/revoke-sessions", {
      method: "POST",
      headers: auth,
    });
    expect(res.status).toBe(404);
  });

  it("workspaces list includes member/collection counts", async () => {
    seedUser("u1", "o@x.io");
    db.prepare(
      `INSERT INTO workspaces (id, name, owner_id, created_at, updated_at) VALUES ('w1','Team','u1',?,?)`,
    ).run(Date.now(), Date.now());
    db.prepare(
      `INSERT INTO memberships (workspace_id, user_id, role, created_at) VALUES ('w1','u1','owner',?)`,
    ).run(Date.now());
    db.prepare(
      `INSERT INTO collections (id, workspace_id, name, data, version, updated_at, updated_by)
       VALUES ('c1','w1','Coll','{}',1,?, 'u1')`,
    ).run(Date.now());

    const res = await app().request("/api/admin/workspaces", { headers: auth });
    const body = (await res.json()) as {
      workspaces: Array<{ memberCount: number; collectionCount: number; ownerEmail: string }>;
    };
    expect(body.workspaces[0].memberCount).toBe(1);
    expect(body.workspaces[0].collectionCount).toBe(1);
    expect(body.workspaces[0].ownerEmail).toBe("o@x.io");
  });

  it("activity feed joins actor + workspace names", async () => {
    seedUser("u1", "a@x.io");
    db.prepare(
      `INSERT INTO workspaces (id, name, owner_id, created_at, updated_at) VALUES ('w1','WS','u1',?,?)`,
    ).run(Date.now(), Date.now());
    db.prepare(
      `INSERT INTO activity_log (workspace_id, actor_id, action, entity_type, entity_id, created_at)
       VALUES ('w1','u1','collection.updated','collection','c1',?)`,
    ).run(Date.now());

    const res = await app().request("/api/admin/activity", { headers: auth });
    const body = (await res.json()) as {
      activity: Array<{ action: string; actorEmail: string; workspaceName: string }>;
    };
    expect(body.activity[0].action).toBe("collection.updated");
    expect(body.activity[0].actorEmail).toBe("a@x.io");
    expect(body.activity[0].workspaceName).toBe("WS");
  });
});

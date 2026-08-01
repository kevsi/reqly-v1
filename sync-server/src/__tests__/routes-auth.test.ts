import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import authRoute from "../routes/auth.js";
import db from "../db.js";
import { parseSessionCookie } from "../auth.js";

function buildApp() {
  const app = new Hono();
  app.route("/api/auth", authRoute);
  return app;
}

const SIGNUP = (email: string, password = "supersecret", name?: string) => ({
  method: "POST" as const,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(name ? { email, password, name } : { email, password }),
});

async function signupAndVerify(
  app: ReturnType<typeof buildApp>,
  email: string,
  password = "supersecret",
  name?: string,
) {
  await app.request("/api/auth/signup", SIGNUP(email, password, name));
  const row = db
    .prepare("SELECT id, verification_code FROM users WHERE email = ?")
    .get(email) as { id: string; verification_code: string } | undefined;
  if (!row?.verification_code) throw new Error("No verification code for " + email);
  return await app.request("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code: row.verification_code }),
  });
}

beforeEach(() => {
  process.env.AUTH_SIGNING_SECRET = "test-secret-do-not-use-in-prod";
  db.exec(`
    DELETE FROM memberships;
    DELETE FROM invitations;
    DELETE FROM workspaces;
    DELETE FROM users;
  `);
});

describe("routes/auth — signup", () => {
  it("creates an unverified user and returns userId + email (no token, no password hash leaked)", async () => {
    const app = buildApp();
    const res = await app.request(
      "/api/auth/signup",
      SIGNUP("alice@example.com", "supersecret", "Alice"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      userId: string;
      email: string;
      message: string;
    };
    expect(body.email).toBe("alice@example.com");
    expect(body.userId).toBeTruthy();
    expect(body.message).toContain("vérification");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).not.toContain("auth_session=");
    const row = db
      .prepare("SELECT password_hash FROM users WHERE id = ?")
      .get(body.userId) as { password_hash: string } | undefined;
    expect(row?.password_hash).toBeTruthy();
    expect(row?.password_hash).not.toContain("supersecret");
    expect(row?.password_hash).toContain(":");
  });

  it("rejects a password shorter than 8 characters", async () => {
    const app = buildApp();
    const res = await app.request("/api/auth/signup", SIGNUP("bob@example.com", "short"));
    expect(res.status).toBe(400);
  });

  it("rejects an invalid email", async () => {
    const app = buildApp();
    const res = await app.request("/api/auth/signup", SIGNUP("not-an-email", "supersecret"));
    expect(res.status).toBe(400);
  });

  it("rejects a duplicate email with 409", async () => {
    const app = buildApp();
    await app.request("/api/auth/signup", SIGNUP("dup@example.com"));
    const res = await app.request("/api/auth/signup", SIGNUP("dup@example.com"));
    expect(res.status).toBe(409);
  });

  it("stores a hashed password, not the plaintext", async () => {
    const app = buildApp();
    await app.request("/api/auth/signup", SIGNUP("hash@example.com", "supersecret"));
    const row = db
      .prepare("SELECT password_hash FROM users WHERE email = ?")
      .get("hash@example.com") as {
      password_hash: string;
    };
    expect(row.password_hash).toBeTruthy();
    expect(row.password_hash).not.toContain("supersecret");
    expect(row.password_hash).toContain(":");
  });
});

describe("routes/auth — login", () => {
  it("returns a token for valid credentials", async () => {
    const app = buildApp();
    await signupAndVerify(app, "carol@example.com", "supersecret", "Carol");
    const res = await app.request("/api/auth/login", SIGNUP("carol@example.com", "supersecret"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { email: string }; token: string };
    expect(body.user.email).toBe("carol@example.com");
    expect(body.token).toContain(".");
  });

  it("rejects an unverified user with 403", async () => {
    const app = buildApp();
    await app.request("/api/auth/signup", SIGNUP("dave@example.com", "supersecret"));
    const res = await app.request("/api/auth/login", SIGNUP("dave@example.com", "supersecret"));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; needsVerification: boolean };
    expect(body.needsVerification).toBe(true);
  });

  it("rejects a wrong password with a generic 401", async () => {
    const app = buildApp();
    await signupAndVerify(app, "elise@example.com", "supersecret");
    const res = await app.request("/api/auth/login", SIGNUP("elise@example.com", "wrongpass"));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    // Generic message — must not reveal whether the email exists or the password was wrong.
    expect(body.error).not.toMatch(/password|mot de passe|existe/i);
  });

  it("rejects an unknown email with a generic 401", async () => {
    const app = buildApp();
    const res = await app.request("/api/auth/login", SIGNUP("nobody@example.com", "supersecret"));
    expect(res.status).toBe(401);
  });
});

describe("routes/auth — me / session", () => {
  it("GET /me returns the user when authenticated via Bearer token", async () => {
    const app = buildApp();
    const verifyRes = await signupAndVerify(app, "erin@example.com", "supersecret", "Erin");
    const { token } = (await verifyRes.json()) as { token: string };
    const res = await app.request("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { email: string } };
    expect(body.user.email).toBe("erin@example.com");
  });

  it("GET /me returns the user when authenticated via session cookie", async () => {
    const app = buildApp();
    const verifyRes = await signupAndVerify(app, "frank@example.com", "supersecret");
    const setCookie = verifyRes.headers.get("set-cookie") ?? "";
    const res = await app.request("/api/auth/me", { headers: { cookie: setCookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { email: string } };
    expect(body.user.email).toBe("frank@example.com");
  });

  it("GET /me returns 401 without any credential", async () => {
    const app = buildApp();
    const res = await app.request("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("POST /logout clears the session cookie", async () => {
    const app = buildApp();
    const verifyRes = await signupAndVerify(app, "grace@example.com", "supersecret");
    const setCookie = verifyRes.headers.get("set-cookie") ?? "";
    const res = await app.request("/api/auth/logout", {
      method: "POST",
      headers: { cookie: setCookie },
    });
    expect(res.status).toBe(200);
    const cleared = res.headers.get("set-cookie") ?? "";
    expect(cleared).toMatch(/auth_session=;|auth_session=.*Max-Age=0|expires=/i);
  });
});

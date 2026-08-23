import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import authRoute, { _testCodes } from "../routes/auth.js";
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

/**
 * Codes are stored HASHED since audit M4 â€” tests fetch the freshly issued
 * plaintext from the NODE_ENV=test-only side channel instead of the DB.
 */
function issuedCode(kind: "verify" | "reset", email: string): string {
  const code = _testCodes.get(`${kind}:${email}`);
  if (!code) throw new Error(`No ${kind} code recorded for ${email}`);
  return code;
}

async function signupAndVerify(
  app: ReturnType<typeof buildApp>,
  email: string,
  password = "supersecret",
  name?: string,
) {
  await app.request("/api/auth/signup", SIGNUP(email, password, name));
  const code = issuedCode("verify", email);
  return await app.request("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code }),
  });
}

async function requestReset(app: ReturnType<typeof buildApp>, email: string) {
  await app.request("/api/auth/forgot-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  return issuedCode("reset", email);
}

beforeEach(() => {
  process.env.AUTH_SIGNING_SECRET = "test-secret-do-not-use-in-prod";
  // password_resets references users(id) with FK enforcement on â€” clear it first.
  db.exec("DELETE FROM password_resets;");
  db.exec(`
    DELETE FROM activity_log; DELETE FROM memberships;
    DELETE FROM invitations;
    DELETE FROM workspaces;
    DELETE FROM users;
  `);
  _testCodes.clear();
});

describe("routes/auth â€” signup", () => {
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
    const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(body.userId) as
      { password_hash: string } | undefined;
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

describe("routes/auth â€” verify (no bypass)", () => {
  it("rejects a wrong code even for an already-verified account (no session minted)", async () => {
    const app = buildApp();
    await signupAndVerify(app, "mallory@example.com", "supersecret");
    const res = await app.request("/api/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "mallory@example.com", code: "000000" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/code|vérification/i);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).not.toContain("auth_session=");
  });

  it("still issues a session when the code is correct", async () => {
    const app = buildApp();
    await app.request("/api/auth/signup", SIGNUP("nina@example.com", "supersecret"));
    const res = await app.request("/api/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "nina@example.com",
        code: issuedCode("verify", "nina@example.com"),
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string };
    expect(body.token).toContain(".");
  });

  it("reports remaining attempts when a verification code is wrong", async () => {
    const app = buildApp();
    await app.request("/api/auth/signup", SIGNUP("remain@example.com", "supersecret"));
    const res = await app.request("/api/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "remain@example.com", code: "000000" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { attemptsRemaining?: number; error: string };
    expect(body.attemptsRemaining).toBe(4);
    expect(body.error).toMatch(/tentatives/i);
  });
});

describe("routes/auth â€” login", () => {
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
    // Generic message â€” must not reveal whether the email exists or the password was wrong.
    expect(body.error).not.toMatch(/password|mot de passe|existe/i);
  });

  it("rejects an unknown email with a generic 401", async () => {
    const app = buildApp();
    const res = await app.request("/api/auth/login", SIGNUP("nobody@example.com", "supersecret"));
    expect(res.status).toBe(401);
  });
});

describe("routes/auth â€” login lockout", () => {
  it("locks the account after MAX_FAILED_LOGINS wrong passwords, then rejects even the correct one with 429", async () => {
    const app = buildApp();
    await signupAndVerify(app, "lock1@example.com", "supersecret");
    for (let i = 0; i < 5; i++) {
      const fail = await app.request("/api/auth/login", SIGNUP("lock1@example.com", "wrongpass"));
      expect(fail.status).toBe(401);
    }
    // Lock is active: even the correct password is refused.
    const res = await app.request("/api/auth/login", SIGNUP("lock1@example.com", "supersecret"));
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/trop de tentatives/i);
  });

  it("returns 429 while locked and unlocks once locked_until has passed", async () => {
    const app = buildApp();
    await signupAndVerify(app, "lock2@example.com", "supersecret");
    db.prepare("UPDATE users SET locked_until = ? WHERE email = ?").run(
      Date.now() + 60_000,
      "lock2@example.com",
    );
    const locked = await app.request("/api/auth/login", SIGNUP("lock2@example.com", "supersecret"));
    expect(locked.status).toBe(429);

    // Lock expired â†’ login works again.
    db.prepare("UPDATE users SET locked_until = ? WHERE email = ?").run(
      Date.now() - 1000,
      "lock2@example.com",
    );
    const unlocked = await app.request(
      "/api/auth/login",
      SIGNUP("lock2@example.com", "supersecret"),
    );
    expect(unlocked.status).toBe(200);
  });

  it("resets counters after a successful login so a single later failure stays 401", async () => {
    const app = buildApp();
    await signupAndVerify(app, "reset@example.com", "supersecret");
    await app.request("/api/auth/login", SIGNUP("reset@example.com", "wrongpass"));
    const ok = await app.request("/api/auth/login", SIGNUP("reset@example.com", "supersecret"));
    expect(ok.status).toBe(200);
    const row = db
      .prepare("SELECT failed_login_attempts, locked_until FROM users WHERE email = ?")
      .get("reset@example.com") as {
      failed_login_attempts: number;
      locked_until: number | null;
    };
    expect(row.failed_login_attempts).toBe(0);
    expect(row.locked_until).toBeNull();

    const res = await app.request("/api/auth/login", SIGNUP("reset@example.com", "wrongpass"));
    expect(res.status).toBe(401);
  });
});

describe("routes/auth â€” me / session", () => {
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

// â”€â”€ Regression tests from the 2026-08 security audit â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("routes/auth â€” audit M4: codes are stored hashed, never plaintext", () => {
  it("stores verification codes as SHA-256 hex (64 chars), not the plaintext", async () => {
    const app = buildApp();
    await app.request("/api/auth/signup", SIGNUP("hashed@example.com"));
    const plain = issuedCode("verify", "hashed@example.com");
    const row = db
      .prepare("SELECT verification_code FROM users WHERE email = ?")
      .get("hashed@example.com") as { verification_code: string };
    expect(row.verification_code).toMatch(/^[0-9a-f]{64}$/);
    expect(row.verification_code).not.toBe(plain);
  });

  it("stores password-reset codes as SHA-256 hex, not the plaintext", async () => {
    const app = buildApp();
    await signupAndVerify(app, "reset-hash@example.com");
    await requestReset(app, "reset-hash@example.com");
    const plain = issuedCode("reset", "reset-hash@example.com");
    const row = db
      .prepare("SELECT code FROM password_resets ORDER BY created_at DESC LIMIT 1")
      .get() as {
      code: string;
    };
    expect(row.code).toMatch(/^[0-9a-f]{64}$/);
    expect(row.code).not.toBe(plain);
  });
});

describe("routes/auth â€” audit H2: reset-code brute-force guard", () => {
  it("reports remaining attempts on each wrong submission", async () => {
    const app = buildApp();
    await signupAndVerify(app, "attempts@example.com", "supersecret");
    const code = await requestReset(app, "attempts@example.com");

    // First wrong guess: 4 attempts should remain before invalidation.
    const first = await app.request("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "attempts@example.com",
        code: "000000",
        newPassword: "newsecret123",
      }),
    });
    expect(first.status).toBe(400);
    const firstBody = (await first.json()) as { attemptsRemaining?: number };
    expect(firstBody.attemptsRemaining).toBe(4);

    // Burn the rest â€” the last one must announce zero remaining.
    for (let i = 0; i < 3; i++) {
      await app.request("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "attempts@example.com",
          code: "000001",
          newPassword: "newsecret123",
        }),
      });
    }
    const lastWrong = await app.request("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "attempts@example.com",
        code: "000002",
        newPassword: "newsecret123",
      }),
    });
    const lastBody = (await lastWrong.json()) as { attemptsRemaining?: number };
    expect(lastBody.attemptsRemaining).toBe(0);

    // Code is now voided: even the CORRECT code is rejected with guidance.
    const res = await app.request("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "attempts@example.com",
        code,
        newPassword: "newsecret123",
      }),
    });
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: string; codeInvalidated?: boolean };
    expect(body.error).toMatch(/trop de tentatives/i);
    expect(body.codeInvalidated).toBe(true);
  });

  it("voids the reset code after MAX_RESET_ATTEMPTS bad guesses (429 even with the correct code)", async () => {
    const app = buildApp();
    await signupAndVerify(app, "brute@example.com", "supersecret");
    const code = await requestReset(app, "brute@example.com");

    // 5 wrong guesses exhaust the per-code budget.
    for (let i = 0; i < 5; i++) {
      const fail = await app.request("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "brute@example.com",
          code: "000000",
          newPassword: "newsecret123",
        }),
      });
      expect(fail.status).toBe(400);
    }

    // The code is now voided: even the CORRECT code is rejected.
    const res = await app.request("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "brute@example.com",
        code,
        newPassword: "newsecret123",
      }),
    });
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/trop de tentatives/i);
  });

  it("still resets the password when the correct code is submitted first try", async () => {
    const app = buildApp();
    await signupAndVerify(app, "happy-path@example.com", "supersecret");
    const code = await requestReset(app, "happy-path@example.com");

    const res = await app.request("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "happy-path@example.com", code, newPassword: "newsecret123" }),
    });
    expect(res.status).toBe(200);

    // Login works with the new passwordâ€¦
    const login = await app.request(
      "/api/auth/login",
      SIGNUP("happy-path@example.com", "newsecret123"),
    );
    expect(login.status).toBe(200);
    // â€¦and no longer with the old one.
    const oldLogin = await app.request(
      "/api/auth/login",
      SIGNUP("happy-path@example.com", "supersecret"),
    );
    expect(oldLogin.status).toBe(401);
  });
});

describe("routes/auth â€” audit H3: password reset revokes outstanding sessions", () => {
  it("invalidates a previously issued session token after a successful reset", async () => {
    const app = buildApp();
    const verifyRes = await signupAndVerify(app, "revoke@example.com", "supersecret");
    const { token } = (await verifyRes.json()) as { token: string };

    // Session is valid before the resetâ€¦
    const before = await app.request("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(before.status).toBe(200);

    // â€¦then the password is reset.
    const code = await requestReset(app, "revoke@example.com");
    const reset = await app.request("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "revoke@example.com", code, newPassword: "newsecret123" }),
    });
    expect(reset.status).toBe(200);

    // The old token must now be dead (token_version bumped).
    const after = await app.request("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(after.status).toBe(401);
  });

  it("bumps token_version on the user row (parseSessionCookie ver mismatch â‡’ revoked)", async () => {
    const app = buildApp();
    const verifyRes = await signupAndVerify(app, "ver@example.com", "supersecret");
    const { token } = (await verifyRes.json()) as { token: string };
    const oldPayload = parseSessionCookie(token);
    expect(oldPayload?.ver).toBeDefined();

    const code = await requestReset(app, "ver@example.com");
    await app.request("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "ver@example.com", code, newPassword: "newsecret123" }),
    });

    const row = db
      .prepare("SELECT token_version FROM users WHERE email = ?")
      .get("ver@example.com") as {
      token_version: number;
    };
    expect(row.token_version).toBe((oldPayload?.ver ?? 0) + 1);
  });
});

describe("routes/auth â€” two-step reset (/verify-reset-code)", () => {
  it("validates the code without consuming it; the real reset still works after", async () => {
    const app = buildApp();
    await signupAndVerify(app, "twostep@example.com", "supersecret");
    const code = await requestReset(app, "twostep@example.com");

    const check = await app.request("/api/auth/verify-reset-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "twostep@example.com", code }),
    });
    expect(check.status).toBe(200);
    const checkBody = (await check.json()) as { valid?: boolean };
    expect(checkBody.valid).toBe(true);

    // The code was NOT consumed by the check: full reset succeeds afterwards.
    const reset = await app.request("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "twostep@example.com", code, newPassword: "newsecret123" }),
    });
    expect(reset.status).toBe(200);
  });

  it("shares the attempt counter with /reset-password (no bypass via the check endpoint)", async () => {
    const app = buildApp();
    await signupAndVerify(app, "sharedctr@example.com", "supersecret");
    const code = await requestReset(app, "sharedctr@example.com");

    // 4 wrong guesses through the CHECK endpointâ€¦
    for (let i = 0; i < 4; i++) {
      const bad = await app.request("/api/auth/verify-reset-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "sharedctr@example.com", code: `00000${i}` }),
      });
      expect(bad.status).toBe(400);
    }
    // â€¦and the 5th wrong guess through RESET exhausts the shared budget.
    const fifth = await app.request("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "sharedctr@example.com",
        code: "999999",
        newPassword: "newsecret123",
      }),
    });
    expect(fifth.status).toBe(400);
    const fifthBody = (await fifth.json()) as { attemptsRemaining?: number };
    expect(fifthBody.attemptsRemaining).toBe(0);

    // Correct code is now voided on BOTH endpoints.
    const voidedCheck = await app.request("/api/auth/verify-reset-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "sharedctr@example.com", code }),
    });
    expect(voidedCheck.status).toBe(429);
  });
});

describe("routes/auth â€” audit C1: /oauth-login requires proof of GitHub ownership", () => {
  it("rejects a request without an accessToken (schema-level)", async () => {
    const app = buildApp();
    const res = await app.request("/api/auth/oauth-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "github",
        providerId: "12345",
        email: "victim@example.com",
        name: "Victim",
      }),
    });
    expect(res.status).toBe(400);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).not.toContain("auth_session=");
  });

  it("rejects non-github providers outright", async () => {
    const app = buildApp();
    const res = await app.request("/api/auth/oauth-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "evil-oauth",
        providerId: "12345",
        email: "someone@example.com",
        accessToken: "whatever-token",
      }),
    });
    expect(res.status).toBe(400);
  });
});

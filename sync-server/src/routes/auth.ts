import { Hono, type Context } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import { randomBytes, scrypt, timingSafeEqual, createHmac } from "node:crypto";
import { promisify } from "node:util";
import db from "../db.js";
import { requireAuth, createSessionToken, type AuthContext } from "../auth.js";
import { createWsTicket } from "../ws-ticket.js";
import { safeParseJson } from "../validation.js";
import { clientIp } from "../rate-limiter.js";
import { TtlMap } from "../ttl-map.js";
import {
  generateVerificationCode,
  sendVerificationCode,
  sendWelcomeEmail,
  sendPasswordResetEmail,
} from "../email.js";

const scryptAsync = promisify(scrypt);

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const VERIFICATION_CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const COOKIE_NAME = "auth_session";

// Brute-force guard for the 6-digit verification code (10^6 space — guesses
// are cheap, so a per-code attempt cap is required). In-memory is fine here:
// this server is single-instance by design. Keyed by the stored (hashed) code
// value so each issuance starts with a fresh counter. TTLs are deliberately
// longer than the 15-min code lifetime: an evicted entry can only reset the
// counter of an already-dead code.
const MAX_VERIFY_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60_000;
// Same per-code attempt cap applies to password-reset codes; the code is
// voided once exhausted.
const MAX_RESET_ATTEMPTS = 5;

// Brute-force guard for password logins: after MAX_FAILED_LOGINS consecutive
// failures the account is locked for LOCKOUT_MS (persisted on the user row so
// it survives restarts and applies across clients). Counters reset on success.
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
// TtlMap (not raw Map): these were unbounded — `forgotCooldowns` is keyed by
// IP, so every visiting IP added a permanent entry (memory DoS on a service
// capped at 300 MB).
const codeAttempts = new TtlMap<number>(30 * 60_000);
const resendCooldowns = new TtlMap<number>(10 * 60_000);
const resetAttempts = new TtlMap<number>(30 * 60_000);
// Per-IP cooldown on /forgot-password: the endpoint always answers success, so
// without a cap it doubles as a free email-bombing relay (fire-and-forget send).
const forgotCooldowns = new TtlMap<number>(10 * 60_000);

/**
 * Verification and reset codes are persisted as HMAC-SHA256 digests keyed by
 * AUTH_SIGNING_SECRET instead of plaintext. A bare SHA-256 of a 6-digit code
 * is trivially reversible with a 10^6-entry rainbow table if the DB leaks;
 * the keyed HMAC is not. Comparisons stay timing-safe (fixed-length hex).
 */
function hashCode(code: string): string {
  const secret = process.env.AUTH_SIGNING_SECRET || "dev-insecure";
  return createHmac("sha256", secret).update(`reqly:code:${code}`, "utf8").digest("hex");
}

/** Test-only: exposes freshly issued plaintext codes when running under vitest
 * (the sync-server vitest config forces NODE_ENV=production, so we key on the
 * VITEST env var instead). */
export const _testCodes = new Map<string, string>();
function recordTestCode(kind: "verify" | "reset", email: string, plain: string) {
  if (process.env.VITEST) _testCodes.set(`${kind}:${email}`, plain);
}

/** Test-only: cooldown maps so beforeEach can reset rate-limit state. */
export const _testCooldowns = { resend: resendCooldowns, forgot: forgotCooldowns };

function invalidateCode(userId: string, code: string | null) {
  if (code) codeAttempts.delete(code);
  db.prepare(
    "UPDATE users SET verification_code = NULL, verification_code_expires_at = NULL WHERE id = ?",
  ).run(userId);
}

// --- Password hashing (scrypt, no external dependency) -------------------
// Stored as `<saltHex>:<hashHex>`. scrypt is memory-hard and side-channel
// resistant; we compare with timingSafeEqual to avoid leaking timing.

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  const hashBuf = Buffer.from(hash, "hex");
  if (hashBuf.length !== derived.length) return false;
  return timingSafeEqual(hashBuf, derived);
}

// --- Session issuance -----------------------------------------------------

function issueSession(c: Context, user: { id: string; email: string; name: string | null }) {
  const expires = Date.now() + SESSION_TTL_MS;
  const ver =
    (
      db.prepare("SELECT token_version FROM users WHERE id = ?").get(user.id) as
        { token_version: number } | undefined
    )?.token_version ?? 0;
  const token = createSessionToken({
    email: user.email,
    name: user.name ?? "",
    provider: "password",
    userId: user.id,
    expires,
    ver,
  });
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
    secure: process.env.NODE_ENV === "production",
  });
  return token;
}

function publicUser(user: { id: string; email: string; name: string | null }) {
  return { id: user.id, email: user.email, name: user.name ?? "" };
}

// --- Helpers --------------------------------------------------------------

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  password_hash: string | null;
  verified: number;
  verification_code: string | null;
  verification_code_expires_at: number | null;
}

function getUserByEmail(email: string): UserRow | undefined {
  return db
    .prepare(
      `SELECT id, email, name, password_hash, verified, verification_code, verification_code_expires_at
       FROM users WHERE email = ?`,
    )
    .get(email) as UserRow | undefined;
}

function setVerificationCode(email: string, userId: string, code: string) {
  const expiresAt = Date.now() + VERIFICATION_CODE_TTL_MS;
  const prev = db.prepare("SELECT verification_code FROM users WHERE id = ?").get(userId) as
    { verification_code: string | null } | undefined;
  if (prev?.verification_code) codeAttempts.delete(prev.verification_code);
  db.prepare(
    "UPDATE users SET verification_code = ?, verification_code_expires_at = ? WHERE id = ?",
  ).run(hashCode(code), expiresAt, userId);
  recordTestCode("verify", email, code);
}

function markVerified(userId: string) {
  const prev = db.prepare("SELECT verification_code FROM users WHERE id = ?").get(userId) as
    { verification_code: string | null } | undefined;
  if (prev?.verification_code) codeAttempts.delete(prev.verification_code);
  db.prepare(
    "UPDATE users SET verified = 1, verification_code = NULL, verification_code_expires_at = NULL WHERE id = ?",
  ).run(userId);
}

// --- Schemas --------------------------------------------------------------

const SignupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  name: z.string().max(80).optional(),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});

const VerifySchema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
});

const ResendCodeSchema = z.object({
  email: z.string().email(),
});

const ForgotPasswordSchema = z.object({
  email: z.string().email(),
});

const ResetPasswordSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
  newPassword: z.string().min(8).max(200),
});

const OAuthLoginSchema = z.object({
  provider: z.string().min(1).max(50),
  providerId: z.string().min(1).max(100),
  email: z.string().email(),
  name: z.string().max(80).optional(),
  /**
   * The caller must present the GitHub access token obtained through the
   * OAuth code exchange. The server validates it against api.github.com/user
   * and only proceeds when the account id and verified email match.
   */
  accessToken: z.string().min(1),
});

const auth = new Hono<{ Variables: { auth: AuthContext } }>();

// ── POST /signup ─────────────────────────────────────────────────────────
// Creates the user UNVERIFIED and sends a 6-digit code to their email.
// Returns { userId, email } — NO session token. User must call /verify.

auth.post("/signup", async (c) => {
  const parsed = await safeParseJson(c, SignupSchema);
  if (!parsed.success) return parsed.response;
  const email = parsed.data.email.toLowerCase();

  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) {
    return c.json({ error: "Un compte existe déjà avec cet email" }, 409);
  }

  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(parsed.data.password);
  try {
    db.prepare(
      `INSERT INTO users (id, email, name, password_hash, verified, created_at)
       VALUES (?, ?, ?, ?, 0, ?)`,
    ).run(id, email, parsed.data.name ?? null, passwordHash, Date.now());
  } catch (err) {
    // UNIQUE(users.email): a concurrent signup won the race between the
    // SELECT above and this INSERT.
    if (String(err).includes("UNIQUE")) {
      return c.json({ error: "Un compte existe déjà avec cet email" }, 409);
    }
    throw err;
  }

  // Generate and send verification code
  const code = generateVerificationCode();
  setVerificationCode(email, id, code);

  try {
    await sendVerificationCode(email, code);
  } catch (err) {
    console.error("[auth] Failed to send verification email:", err);
    // Account is created but the code could not be delivered.
    // Return an error so the client knows to check the email config / resend.
    return c.json(
      {
        error:
          "Compte créé mais impossible d'envoyer le code de vérification. Vérifiez la configuration email du serveur, puis utilisez « Renvoyer le code ».",
        userId: id,
        email,
      },
      502,
    );
  }

  return c.json({
    userId: id,
    email,
    message: "Un code de vérification vous a été envoyé par email.",
  });
});

// ── POST /verify ─────────────────────────────────────────────────────────
// Verifies the 6-digit code. If valid, marks the user as verified and
// issues a session token (logs them in).

auth.post("/verify", async (c) => {
  const parsed = await safeParseJson(c, VerifySchema);
  if (!parsed.success) return parsed.response;
  const email = parsed.data.email.toLowerCase();
  const code = parsed.data.code;

  const user = getUserByEmail(email);
  if (!user) {
    // Anti-enumeration: answer exactly like an account with no active code —
    // a 404 here would confirm whether an email is registered.
    return c.json({ error: "Aucun code de vérification actif. Demandez-en un nouveau." }, 400);
  }

  if (!user.verification_code || !user.verification_code_expires_at) {
    return c.json({ error: "Aucun code de vérification actif. Demandez-en un nouveau." }, 400);
  }

  if (Date.now() > user.verification_code_expires_at) {
    return c.json({ error: "Le code de vérification a expiré. Demandez-en un nouveau." }, 400);
  }

  // Brute-force guard: cap attempts per code, then invalidate it.
  const attempts = codeAttempts.get(user.verification_code) ?? 0;
  if (attempts >= MAX_VERIFY_ATTEMPTS) {
    invalidateCode(user.id, user.verification_code);
    return c.json(
      {
        error: "Trop de tentatives. Ce code a été annulé — demandez-en un nouveau.",
      },
      429,
    );
  }

  // Timing-safe comparison: the submitted code is hashed the same way as the
  // stored value before comparing.
  const codeBuf = Buffer.from(hashCode(code));
  const storedBuf = Buffer.from(user.verification_code);
  if (codeBuf.length !== storedBuf.length || !timingSafeEqual(codeBuf, storedBuf)) {
    codeAttempts.set(user.verification_code, attempts + 1);
    // SECURITY: never disclose attemptsRemaining — it confirms account
    // existence and paces brute-force attempts (same rule as /verify-reset-code).
    return c.json({ error: "Code de vérification incorrect." }, 400);
  }

  // Mark verified
  markVerified(user.id);

  // Send welcome email (fire-and-forget)
  sendWelcomeEmail(user.email, user.name ?? undefined).catch((err) =>
    console.error("[auth] Failed to send welcome email:", err),
  );

  // Issue session
  const token = issueSession(c, user);
  return c.json({ user: publicUser(user), token });
});

// ── POST /resend-code ────────────────────────────────────────────────────
// Resends the verification code to the user's email.

auth.post("/resend-code", async (c) => {
  const parsed = await safeParseJson(c, ResendCodeSchema);
  if (!parsed.success) return parsed.response;
  const email = parsed.data.email.toLowerCase();

  // Throttle BEFORE any account lookup, keyed by the submitted email only, so
  // the 429 cannot be used to distinguish existing from unknown accounts.
  const lastResend = resendCooldowns.get(email) ?? 0;
  if (Date.now() - lastResend < RESEND_COOLDOWN_MS) {
    return c.json({ error: "Attendez une minute avant de demander un nouveau code." }, 429);
  }

  const user = getUserByEmail(email);
  if (!user || user.verified) {
    // Anti-enumeration: unknown emails AND already-verified accounts get the
    // same success-shaped answer (no email is sent, nothing is revealed).
    return c.json({ message: "Un nouveau code de vérification vous a été envoyé par email." });
  }

  // Generate a new code (invalidates old one)
  const code = generateVerificationCode();
  setVerificationCode(email, user.id, code);
  resendCooldowns.set(email, Date.now());

  try {
    await sendVerificationCode(email, code);
  } catch (err) {
    console.error("[auth] Failed to resend verification email:", err);
    return c.json({ error: "Impossible d'envoyer l'email de vérification." }, 500);
  }

  return c.json({ message: "Un nouveau code de vérification vous a été envoyé par email." });
});

// ── POST /forgot-password ────────────────────────────────────────────────
// Sends a 6-digit reset code to the user's email. Always returns success
// to avoid revealing whether the email exists.

auth.post("/forgot-password", async (c) => {
  const parsed = await safeParseJson(c, ForgotPasswordSchema);
  if (!parsed.success) return parsed.response;
  const email = parsed.data.email.toLowerCase();

  // Per-IP cooldown: without it, the fire-and-forget email send makes this
  // endpoint an email-bombing relay even though it leaks no information.
  const ip = clientIp(c);
  const lastForgot = forgotCooldowns.get(ip) ?? 0;
  if (Date.now() - lastForgot < RESEND_COOLDOWN_MS) {
    return c.json({ error: "Attendez une minute avant de demander un nouveau code." }, 429);
  }

  const user = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as
    { id: string } | undefined;

  if (!user) {
    // Always return success to prevent email enumeration
    return c.json({
      message: "Si un compte existe avec cet email, un code de réinitialisation vous a été envoyé.",
    });
  }

  forgotCooldowns.set(ip, Date.now());
  // Generate and store reset code
  const code = generateVerificationCode();
  const resetId = crypto.randomUUID();
  const expiresAt = Date.now() + VERIFICATION_CODE_TTL_MS; // 15 minutes

  db.prepare(
    "INSERT INTO password_resets (id, user_id, code, expires_at, used, created_at) VALUES (?, ?, ?, ?, 0, ?)",
  ).run(resetId, user.id, hashCode(code), expiresAt, Date.now());
  recordTestCode("reset", email, code);

  // Send email (fire-and-forget — don't block the response)
  sendPasswordResetEmail(email, code).catch((err) =>
    console.error("[auth] Failed to send password reset email:", err),
  );

  return c.json({
    message: "Si un compte existe avec cet email, un code de réinitialisation vous a été envoyé.",
  });
});

// ── POST /verify-reset-code ──────────────────────────────────────────────
// Two-step reset flow (UX): validates a password-reset code WITHOUT consuming
// it, so the client can confirm the code first and only then collect the new
// password. Failed attempts share the same per-code counter as /reset-password,
// so splitting the flow cannot bypass the attempt cap.

const VerifyResetCodeSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
});

auth.post("/verify-reset-code", async (c) => {
  const parsed = await safeParseJson(c, VerifyResetCodeSchema);
  if (!parsed.success) return parsed.response;
  const email = parsed.data.email.toLowerCase();
  const code = parsed.data.code;

  const user = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as
    { id: string } | undefined;
  if (!user) {
    // Anti-enumeration: same answer as "no active reset code" — a distinct 404
    // would confirm the email is registered.
    return c.json({ error: "Aucun code de réinitialisation actif. Demandez-en un nouveau." }, 400);
  }

  const resetRow = db
    .prepare(
      "SELECT id, code, expires_at FROM password_resets WHERE user_id = ? AND used = 0 ORDER BY created_at DESC LIMIT 1",
    )
    .get(user.id) as { id: string; code: string; expires_at: number } | undefined;

  if (!resetRow) {
    return c.json({ error: "Aucun code de réinitialisation actif. Demandez-en un nouveau." }, 400);
  }

  if (Date.now() > resetRow.expires_at) {
    return c.json({ error: "Le code de réinitialisation a expiré. Demandez-en un nouveau." }, 400);
  }

  // Same per-code attempt cap as /reset-password.
  const attempts = resetAttempts.get(resetRow.id) ?? 0;
  if (attempts >= MAX_RESET_ATTEMPTS) {
    db.prepare("UPDATE password_resets SET used = 1 WHERE id = ?").run(resetRow.id);
    resetAttempts.delete(resetRow.id);
    return c.json(
      {
        error:
          "Trop de tentatives. Ce code a été annulé — demandez un nouveau code de réinitialisation.",
        codeInvalidated: true,
      },
      429,
    );
  }

  const submittedBuf = Buffer.from(hashCode(code));
  const storedBuf = Buffer.from(resetRow.code);
  if (submittedBuf.length !== storedBuf.length || !timingSafeEqual(submittedBuf, storedBuf)) {
    resetAttempts.set(resetRow.id, attempts + 1);
    // SECURITY: never disclose attemptsRemaining here — combined with a
    // non-consumed code, it turns this endpoint into a guessing oracle that
    // confirms account existence and paces brute-force attempts.
    return c.json({ error: "Code incorrect." }, 400);
  }

  // Valid — deliberately NOT consumed here; /reset-password performs the
  // actual change and marks the code used.
  return c.json({ valid: true });
});

// ── POST /reset-password ─────────────────────────────────────────────────
// Validates the reset code and updates the password.

auth.post("/reset-password", async (c) => {
  const parsed = await safeParseJson(c, ResetPasswordSchema);
  if (!parsed.success) return parsed.response;
  const email = parsed.data.email.toLowerCase();
  const code = parsed.data.code;

  const user = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as
    { id: string } | undefined;

  if (!user) {
    // Anti-enumeration: same generic answer as "no active reset code".
    return c.json({ error: "Aucun code de réinitialisation actif. Demandez-en un nouveau." }, 400);
  }

  // Find the most recent unused reset code for this user
  const resetRow = db
    .prepare(
      "SELECT id, code, expires_at FROM password_resets WHERE user_id = ? AND used = 0 ORDER BY created_at DESC LIMIT 1",
    )
    .get(user.id) as { id: string; code: string; expires_at: number } | undefined;

  if (!resetRow) {
    return c.json({ error: "Aucun code de réinitialisation actif. Demandez-en un nouveau." }, 400);
  }

  if (Date.now() > resetRow.expires_at) {
    return c.json({ error: "Le code de réinitialisation a expiré. Demandez-en un nouveau." }, 400);
  }

  // Per-code attempt cap: after too many failed submissions the code is voided.
  const attempts = resetAttempts.get(resetRow.id) ?? 0;
  if (attempts >= MAX_RESET_ATTEMPTS) {
    db.prepare("UPDATE password_resets SET used = 1 WHERE id = ?").run(resetRow.id);
    resetAttempts.delete(resetRow.id);
    return c.json(
      {
        error:
          "Trop de tentatives. Ce code a été annulé — demandez un nouveau code de réinitialisation.",
        codeInvalidated: true,
      },
      429,
    );
  }

  // Timing-safe comparison of hashed codes. SECURITY: no attemptsRemaining in
  // the response — same guessing-oracle rule as /verify-reset-code.
  const submittedBuf = Buffer.from(hashCode(code));
  const storedBuf = Buffer.from(resetRow.code);
  if (submittedBuf.length !== storedBuf.length || !timingSafeEqual(submittedBuf, storedBuf)) {
    resetAttempts.set(resetRow.id, attempts + 1);
    return c.json({ error: "Code de réinitialisation incorrect." }, 400);
  }
  resetAttempts.delete(resetRow.id);

  // Mark the reset code as used
  db.prepare("UPDATE password_resets SET used = 1 WHERE id = ?").run(resetRow.id);

  // Invalidate outstanding sessions: token_version is embedded in all session
  // tokens and checked on every authenticated request, so bumping it here ends
  // previously issued sessions for this user.
  db.prepare("UPDATE users SET token_version = token_version + 1 WHERE id = ?").run(user.id);

  // Update the password
  const passwordHash = await hashPassword(parsed.data.newPassword);
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, user.id);

  return c.json({
    message:
      "Votre mot de passe a été réinitialisé avec succès. Vous pouvez maintenant vous connecter.",
  });
});

// ── POST /oauth-login ───────────────────────────────────────────────────
// OAuth login/register: verifies the caller's GitHub access token against
// api.github.com/user, then finds or creates a user by the VERIFIED email and
// issues a session token. The Next.js callback route and the desktop loopback
// both call this AFTER exchanging the OAuth code for an access token.

const GITHUB_API_HEADERS = {
  Accept: "application/vnd.github+json",
  "User-Agent": "reqly-sync",
} as const;

async function resolveVerifiedGithubEmail(
  accessToken: string,
  fallbackEmail: string | null,
): Promise<string | null> {
  if (fallbackEmail) return fallbackEmail;
  try {
    const res = await fetch("https://api.github.com/user/emails", {
      headers: { ...GITHUB_API_HEADERS, Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const emails = (await res.json()) as Array<{
      email: string;
      primary: boolean;
      verified: boolean;
    }>;
    const primary = emails.find((e) => e.primary && e.verified);
    return primary?.email ?? emails.find((e) => e.verified)?.email ?? null;
  } catch {
    return null;
  }
}

auth.post("/oauth-login", async (c) => {
  const parsed = await safeParseJson(c, OAuthLoginSchema);
  if (!parsed.success) return parsed.response;

  const email = parsed.data.email.toLowerCase();
  const provider = parsed.data.provider;
  const providerId = parsed.data.providerId;
  const name = parsed.data.name ?? null;

  // Only GitHub is supported here, and the access token must match the
  // claimed provider id and verified email.
  if (provider !== "github") {
    return c.json({ error: "Provider non supporté" }, 400);
  }

  let githubId = "";
  let githubEmail: string | null = null;
  try {
    const userRes = await fetch("https://api.github.com/user", {
      headers: { ...GITHUB_API_HEADERS, Authorization: `Bearer ${parsed.data.accessToken}` },
    });
    if (!userRes.ok) {
      return c.json({ error: "Token GitHub invalide ou expiré" }, 401);
    }
    const ghUser = (await userRes.json()) as {
      id?: number | string;
      login?: string;
      email?: string | null;
    };
    githubId = String(ghUser.id ?? "");
    githubEmail = await resolveVerifiedGithubEmail(parsed.data.accessToken, ghUser.email ?? null);
  } catch {
    return c.json({ error: "Vérification du compte GitHub impossible" }, 401);
  }

  if (!githubId || githubId !== providerId) {
    return c.json({ error: "Le token GitHub ne correspond pas à ce compte" }, 401);
  }
  if (!githubEmail || githubEmail.toLowerCase() !== email) {
    return c.json(
      { error: "L'email vérifié du compte GitHub ne correspond pas à celui fourni" },
      401,
    );
  }

  // Find existing user by email
  let user = db
    .prepare("SELECT id, email, name, verified FROM users WHERE email = ?")
    .get(email) as { id: string; email: string; name: string | null; verified: number } | undefined;

  if (user) {
    // User exists — update name if empty, ensure verified
    if (!user.name && name) {
      db.prepare("UPDATE users SET name = ? WHERE id = ?").run(name, user.id);
      user.name = name;
    }
    if (!user.verified) {
      db.prepare("UPDATE users SET verified = 1 WHERE id = ?").run(user.id);
      user.verified = 1;
    }
  } else {
    // Create new user — OAuth users are pre-verified (email confirmed by provider)
    const id = crypto.randomUUID();
    const now = Date.now();
    try {
      db.prepare(
        `INSERT INTO users (id, email, name, verified, created_at) VALUES (?, ?, ?, 1, ?)`,
      ).run(id, email, name, now);
      user = { id, email, name, verified: 1 };
    } catch (err) {
      if (String(err).includes("UNIQUE")) {
        // Race condition: another request created the user — retry select
        user = db
          .prepare("SELECT id, email, name, verified FROM users WHERE email = ?")
          .get(email) as
          { id: string; email: string; name: string | null; verified: number } | undefined;
      } else {
        throw err;
      }
    }
  }

  if (!user) {
    return c.json({ error: "Impossible de créer ou trouver le compte" }, 500);
  }

  // Issue session
  const token = issueSession(c, user);
  return c.json({ user: publicUser(user), token });
});

// ── POST /github-exchange ───────────────────────────────────────────────
// Exchange a GitHub OAuth code for an access token. Used by the desktop
// app which can't do CORS requests to GitHub directly.

const GitHubExchangeSchema = z.object({
  code: z.string().min(1),
  state: z.string().optional(),
  redirect_uri: z.string().optional(),
  // PKCE verifier from the desktop loopback flow; forwarded verbatim to
  // GitHub on the token exchange.
  code_verifier: z.string().min(43).max(128).optional(),
});

/**
 * Strict allowlist of redirect URIs this endpoint will complete. Any other
 * value is rejected.
 *
 * SECURITY: in production the list comes ONLY from the environment — no
 * hard-coded infrastructure URLs (the previous duckdns.org default leaked the
 * deployment topology and could silently survive a domain migration). The
 * hard-coded values remain as dev conveniences outside production.
 */
function githubRedirectAllowlist(): string[] {
  const list = [
    process.env.GITHUB_OAUTH_REDIRECT_WEB,
    process.env.GITHUB_OAUTH_REDIRECT_DESKTOP,
  ].filter((v): v is string => Boolean(v));
  if (process.env.NODE_ENV !== "production") {
    list.push(
      "https://reqly-app.duckdns.org/api/github-auth/callback",
      "http://127.0.0.1:18234/callback",
    );
  }
  return list;
}

auth.post("/github-exchange", async (c) => {
  const parsed = await safeParseJson(c, GitHubExchangeSchema);
  if (!parsed.success) return parsed.response;

  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return c.json({ error: "GitHub OAuth non configuré" }, 500);
  }

  const allowlist = githubRedirectAllowlist();
  const redirectUri = parsed.data.redirect_uri ?? allowlist[0];
  if (!allowlist.includes(redirectUri)) {
    return c.json({ error: "redirect_uri non autorisé" }, 400);
  }

  try {
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code: parsed.data.code,
        redirect_uri: redirectUri,
        ...(parsed.data.code_verifier ? { code_verifier: parsed.data.code_verifier } : {}),
      }),
    });

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      return c.json(
        { error: tokenData.error_description || "Échec de l'échange du code GitHub" },
        400,
      );
    }

    return c.json({ access_token: accessToken });
  } catch (err) {
    return c.json({ error: "Erreur lors de l'échange du code GitHub" }, 500);
  }
});

// ── POST /login ──────────────────────────────────────────────────────────
// Authenticates and issues a session — ONLY if the account is verified.

auth.post("/login", async (c) => {
  const parsed = await safeParseJson(c, LoginSchema);
  if (!parsed.success) return parsed.response;
  const email = parsed.data.email.toLowerCase();

  const user = db
    .prepare(
      `SELECT id, email, name, password_hash, verified, failed_login_attempts, locked_until
       FROM users WHERE email = ?`,
    )
    .get(email) as
    | {
        id: string;
        email: string;
        name: string | null;
        password_hash: string | null;
        verified: number;
        failed_login_attempts: number;
        locked_until: number | null;
      }
    | undefined;

  // Account temporarily locked after too many failed logins. Checked before
  // any password work so locked accounts cost nothing to evaluate.
  if (user?.locked_until && user.locked_until > Date.now()) {
    return c.json({ error: "Trop de tentatives. Réessayez plus tard." }, 429);
  }

  // Equalize timing between "unknown email" and "wrong password": without the
  // dummy derivation, a missing user skips the ~100 ms scrypt work and the
  // response latency confirms whether the email is registered.
  let passwordOk = false;
  if (user?.password_hash) {
    passwordOk = await verifyPassword(parsed.data.password, user.password_hash);
  } else {
    await scryptAsync(parsed.data.password, "reqly-timing-equalizer", 64);
  }

  // Generic failure: never reveal whether the email exists or the password was wrong.
  if (!passwordOk || !user) {
    // Count the failure only for existing accounts (nothing to lock otherwise).
    if (user) {
      const attempts = (user.failed_login_attempts ?? 0) + 1;
      if (attempts >= MAX_FAILED_LOGINS) {
        db.prepare("UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?").run(
          attempts,
          Date.now() + LOCKOUT_MS,
          user.id,
        );
      } else {
        db.prepare("UPDATE users SET failed_login_attempts = ? WHERE id = ?").run(
          attempts,
          user.id,
        );
      }
    }
    return c.json({ error: "Identifiants invalides" }, 401);
  }

  // Successful password verification — reset the lockout counters.
  db.prepare("UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?").run(
    user.id,
  );

  // Block unverified accounts
  if (!user.verified) {
    // Send a fresh verification code so the user always has a valid one.
    // A code from signup may have expired (15 min TTL) or failed to deliver.
    const code = generateVerificationCode();
    setVerificationCode(email, user.id, code);
    try {
      await sendVerificationCode(email, code);
    } catch (err) {
      console.error("[auth] Failed to send verification code on login:", err);
    }
    return c.json(
      {
        error: "Veuillez vérifier votre adresse email avant de vous connecter.",
        needsVerification: true,
        email,
      },
      403,
    );
  }

  const token = issueSession(c, user);
  return c.json({ user: publicUser(user), token });
});

// ── POST /logout ─────────────────────────────────────────────────────────
// Revokes the session: bumps the user's token_version so every outstanding
// stateless token dies (all devices logged out).

auth.post("/logout", requireAuth, (c) => {
  const authCtx = c.get("auth") as AuthContext;
  db.prepare("UPDATE users SET token_version = token_version + 1 WHERE id = ?").run(authCtx.userId);
  deleteCookie(c, COOKIE_NAME, { path: "/", secure: process.env.NODE_ENV === "production" });
  // Also set an expired cookie to ensure the session cookie is cleared
  setCookie(c, COOKIE_NAME, "", {
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
  });
  return c.json({ ok: true });
});

// ── GET /me ──────────────────────────────────────────────────────────────

auth.get("/me", requireAuth, (c) => {
  const authCtx = c.get("auth") as AuthContext;
  const user = db.prepare("SELECT id, email, name FROM users WHERE id = ?").get(authCtx.userId) as
    { id: string; email: string; name: string | null } | undefined;
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  return c.json({ user: publicUser(user) });
});

// ── GET /ws-ticket ───────────────────────────────────────────────────────
// Émet un ticket WS à usage unique (30 s) pour le WebSocket de sync, afin de
// ne jamais exposer le token de session dans le header Sec-WebSocket-Protocol
// (visible dans les logs proxys/load-balancers).

auth.get("/ws-ticket", requireAuth, (c) => {
  const authCtx = c.get("auth") as AuthContext;
  const workspaceId = c.req.query("workspaceId");
  if (!workspaceId) return c.json({ error: "workspaceId requis" }, 400);
  const user = db
    .prepare("SELECT id, token_version FROM users WHERE id = ?")
    .get(authCtx.userId) as { id: string; token_version: number } | undefined;
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const ticket = createWsTicket(user.id, user.token_version, workspaceId);
  return c.json({ ticket });
});

export default auth;

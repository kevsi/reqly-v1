import { Hono, type Context } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import db from "../db.js";
import { requireAuth, createSessionToken, type AuthContext } from "../auth.js";
import { safeParseJson } from "../validation.js";
import {
  generateVerificationCode,
  sendVerificationCode,
  sendWelcomeEmail,
} from "../email.js";

const scryptAsync = promisify(scrypt);

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const VERIFICATION_CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const COOKIE_NAME = "auth_session";

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
  const token = createSessionToken({
    email: user.email,
    name: user.name ?? "",
    provider: "password",
    userId: user.id,
    expires,
  });
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  return token;
}

function publicUser(user: { id: string; email: string; name: string | null }) {
  return { id: user.id, email: user.email, name: user.name ?? "" };
}

// --- Helpers --------------------------------------------------------------

function getUserByEmail(email: string):
  | {
      id: string;
      email: string;
      name: string | null;
      password_hash: string | null;
      verified: number;
      verification_code: string | null;
      verification_code_expires_at: number | null;
    }
  | undefined {
  return db
    .prepare(
      `SELECT id, email, name, password_hash, verified, verification_code, verification_code_expires_at
       FROM users WHERE email = ?`,
    )
    .get(email) as any;
}

function setVerificationCode(userId: string, code: string) {
  const expiresAt = Date.now() + VERIFICATION_CODE_TTL_MS;
  db.prepare(
    "UPDATE users SET verification_code = ?, verification_code_expires_at = ? WHERE id = ?",
  ).run(code, expiresAt, userId);
}

function markVerified(userId: string) {
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
  db.prepare(
    `INSERT INTO users (id, email, name, password_hash, verified, created_at)
     VALUES (?, ?, ?, ?, 0, ?)`,
  ).run(id, email, parsed.data.name ?? null, passwordHash, Date.now());

  // Generate and send verification code
  const code = generateVerificationCode();
  setVerificationCode(id, code);

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
    return c.json({ error: "Aucun compte trouvé avec cet email" }, 404);
  }

  if (user.verified) {
    // Already verified — just issue a session
    const token = issueSession(c, user);
    return c.json({ user: publicUser(user), token });
  }

  if (!user.verification_code || !user.verification_code_expires_at) {
    return c.json({ error: "Aucun code de vérification actif. Demandez-en un nouveau." }, 400);
  }

  if (Date.now() > user.verification_code_expires_at) {
    return c.json({ error: "Le code de vérification a expiré. Demandez-en un nouveau." }, 400);
  }

  // Timing-safe comparison
  const codeBuf = Buffer.from(code);
  const storedBuf = Buffer.from(user.verification_code);
  if (codeBuf.length !== storedBuf.length || !timingSafeEqual(codeBuf, storedBuf)) {
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

  const user = getUserByEmail(email);
  if (!user) {
    return c.json({ error: "Aucun compte trouvé avec cet email" }, 404);
  }

  if (user.verified) {
    return c.json({ error: "Ce compte est déjà vérifié." }, 400);
  }

  // Generate a new code (invalidates old one)
  const code = generateVerificationCode();
  setVerificationCode(user.id, code);

  try {
    await sendVerificationCode(email, code);
  } catch (err) {
    console.error("[auth] Failed to resend verification email:", err);
    return c.json({ error: "Impossible d'envoyer l'email de vérification." }, 500);
  }

  return c.json({ message: "Un nouveau code de vérification vous a été envoyé par email." });
});

// ── POST /login ──────────────────────────────────────────────────────────
// Authenticates and issues a session — ONLY if the account is verified.

auth.post("/login", async (c) => {
  const parsed = await safeParseJson(c, LoginSchema);
  if (!parsed.success) return parsed.response;
  const email = parsed.data.email.toLowerCase();

  const user = db
    .prepare("SELECT id, email, name, password_hash, verified FROM users WHERE email = ?")
    .get(email) as
    | {
        id: string;
        email: string;
        name: string | null;
        password_hash: string | null;
        verified: number;
      }
    | undefined;

  // Generic failure: never reveal whether the email exists or the password was wrong.
  if (
    !user ||
    !user.password_hash ||
    !(await verifyPassword(parsed.data.password, user.password_hash))
  ) {
    return c.json({ error: "Identifiants invalides" }, 401);
  }

  // Block unverified accounts
  if (!user.verified) {
    // Send a fresh verification code so the user always has a valid one.
    // A code from signup may have expired (15 min TTL) or failed to deliver.
    const code = generateVerificationCode();
    setVerificationCode(user.id, code);
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

auth.post("/logout", (c) => {
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

export default auth;

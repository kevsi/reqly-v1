import type { Context, Next } from "hono";
import { createHmac, timingSafeEqual } from "node:crypto";
import db from "./db.js";

/**
 * Escape all regex-special characters in a string so it can be safely
 * interpolated into a `new RegExp(...)` pattern.
 */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface SessionPayload {
  email: string;
  name: string;
  provider: string;
  userId?: string;
  expires: number;
  /** Session token version — bumped on logout to revoke outstanding tokens. */
  ver?: number;
  /**
   * Hard expiry carried by WS-ticket-derived sessions (epoch ms). Regular
   * tokens rely on `expires`; this stays optional so legacy tokens validate.
   */
  exp?: number;
}

const COOKIE_NAME = "auth_session";

export function parseSessionCookie(cookieValue: string | undefined): SessionPayload | null {
  return parseSession(cookieValue);
}

/**
 * Explicit opt-in flag to bypass auth in development.
 *
 * WARNING: Enabling this disables ALL authentication on the sync server.
 * Anyone with network access can read/write any workspace. Only use this
 * for local development when OAuth providers are not configured.
 *
 * Default: false (auth is enforced even in dev environments).
 */
function isAuthBypassEnabled(): boolean {
  return process.env.AUTH_BYPASS === "true";
}

function getSecretRaw(): string {
  return process.env.AUTH_SIGNING_SECRET || "";
}

function getSecret(): string {
  const s = getSecretRaw();
  if (!s) throw new Error("AUTH_SIGNING_SECRET env variable not set");
  return s;
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf-8");
}

function createSignature(payloadBase64: string): string {
  return createHmac("sha256", getSecret()).update(payloadBase64).digest("base64url");
}

/**
 * Build a signed session token (`<base64url(payload)>.<hmac>`). The same string
 * is used both as the `auth_session` cookie value and as a `Bearer` token, so
 * clients (web, desktop/Tauri) can present it either way.
 */
export function createSessionToken(payload: SessionPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${createSignature(encoded)}`;
}

function parseSession(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const [payloadBase64, signature] = token.split(".");
  if (!payloadBase64 || !signature) return null;
  const expectedSignature = createSignature(payloadBase64);
  const sigBuf = Buffer.from(signature, "utf-8");
  const expBuf = Buffer.from(expectedSignature, "utf-8");
  if (sigBuf.length !== expBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const payload = JSON.parse(decodeBase64Url(payloadBase64)) as SessionPayload;
    if (payload.expires < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export interface AuthContext {
  userId: string;
  email: string;
  name: string;
}

/**
 * Session revocation check. Tokens embed `ver` (the user's token_version at
 * issuance); it is bumped on logout, so older tokens fail this check.
 *
 * SECURITY: tokens WITHOUT `ver` (pre-migration legacy tokens) are rejected —
 * they could never be revoked (logout/password-reset/ban would leave them
 * valid for their full 7-day TTL). Users simply log in again to get a
 * versioned token.
 */
export function isSessionRevoked(userId: string, ver?: number): boolean {
  if (ver === undefined) return true;
  const row = db.prepare("SELECT token_version FROM users WHERE id = ?").get(userId) as
    { token_version: number } | undefined;
  return !row || ver !== row.token_version;
}

export async function requireAuth(c: Context, next: Next) {
  const cookieHeader = c.req.header("cookie") ?? "";
  const match = cookieHeader.match(new RegExp(`${escapeRegex(COOKIE_NAME)}=([^;]+)`));
  // Accept either the session cookie OR an `Authorization: Bearer <token>`
  // (same signed format) so desktop/Tauri clients can authenticate without cookies.
  let token = match?.[1];
  if (!token) {
    const authHeader = c.req.header("authorization");
    if (authHeader?.startsWith("Bearer ")) token = authHeader.slice(7).trim();
  }

  let session: SessionPayload | null = null;
  try {
    session = parseSession(token);
  } catch {
    // AUTH_SIGNING_SECRET may not be set in dev — that's fine
  }

  if (session?.userId) {
    // Session revocation: tokens embed a version that must match the user's
    // current token_version (bumped on logout). Stale tokens are rejected.
    if (isSessionRevoked(session.userId, session.ver)) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    // Admin soft-ban: disabled users are rejected everywhere.
    const row = db.prepare(`SELECT disabled FROM users WHERE id = ?`).get(session.userId) as
      { disabled: number | bigint } | undefined;
    if (row?.disabled) {
      return c.json({ error: "Account disabled" }, 403);
    }
    c.set("auth", {
      userId: session.userId,
      email: session.email,
      name: session.name,
    } as AuthContext);
    return next();
  }

  // Auth bypass: create a mock session when AUTH_BYPASS=true is set.
  // Intended for local development without OAuth providers.
  if (isAuthBypassEnabled()) {
    if (process.env.NODE_ENV === "production") {
      console.error("[auth] FATAL: AUTH_BYPASS is enabled in production. Refusing to start.");
      process.exit(1);
    }
    console.warn(
      "[auth] AUTH_BYPASS is enabled — authentication is disabled. " +
        "Set AUTH_BYPASS=false in production.",
    );
    c.set("auth", {
      userId: "dev-user-1",
      email: "dev@reqly.local",
      name: "Developer",
    } as AuthContext);
    return next();
  }

  return c.json({ error: "Unauthorized" }, 401);
}

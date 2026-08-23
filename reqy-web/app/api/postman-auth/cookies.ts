import {
  decryptCookieValue,
  encryptCookieValue,
  signCookieValue,
  verifySignedCookieValue,
} from "@/lib/crypto/cookie-cipher";

const COOKIE_KEY = "postman_api_key";
const COOKIE_USER = "postman_user";
const DURATION_S = 30 * 24 * 60 * 60;

function cookieOpts() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: DURATION_S,
  };
}

export function buildApiKeyCookie(value: string) {
  return { name: COOKIE_KEY, value: encryptCookieValue(value), ...cookieOpts() };
}

export function buildUserCookie(user: { username: string; email?: string }) {
  // HMAC-signed so the JSON payload cannot be forged client-side.
  return { name: COOKIE_USER, value: signCookieValue(JSON.stringify(user)), ...cookieOpts() };
}

export function buildClearCookies() {
  return [
    { name: COOKIE_KEY, value: "", ...cookieOpts(), maxAge: 0 },
    { name: COOKIE_USER, value: "", ...cookieOpts(), maxAge: 0 },
  ];
}

export function getApiKeyFromRequest(request: {
  cookies: { get(name: string): { value: string } | undefined };
}): string | null {
  const raw = request.cookies.get(COOKIE_KEY)?.value;
  if (!raw) return null;
  // Tolerant read: v1 ciphertext is decrypted, legacy plaintext cookies still work.
  return decryptCookieValue(raw);
}

export function getUserFromRequest(request: {
  cookies: { get(name: string): { value: string } | undefined };
}): { username: string; email?: string } | null {
  const raw = request.cookies.get(COOKIE_USER)?.value;
  if (!raw) return null;
  // Invalid signature → treat as disconnected.
  const verified = verifySignedCookieValue(raw);
  if (verified === null) return null;
  try {
    const parsed = JSON.parse(verified) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const user = parsed as { username?: unknown; email?: unknown };
    if (typeof user.username !== "string" || !user.username) return null;
    if (user.email !== undefined && typeof user.email !== "string") return null;
    return user.email !== undefined
      ? { username: user.username, email: user.email }
      : { username: user.username };
  } catch {
    return null;
  }
}

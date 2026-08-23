import { decryptCookieValue, encryptCookieValue } from "@/lib/crypto/cookie-cipher";

const COOKIE_KEY = "jina_api_key";
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

export function buildClearCookies() {
  return [{ name: COOKIE_KEY, value: "", ...cookieOpts(), maxAge: 0 }];
}

export function getApiKeyFromRequest(request: {
  cookies: { get(name: string): { value: string } | undefined };
}): string | null {
  const raw = request.cookies.get(COOKIE_KEY)?.value;
  if (!raw) return null;
  // Tolerant read: v1 ciphertext is decrypted, legacy plaintext cookies still work.
  return decryptCookieValue(raw);
}

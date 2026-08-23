// @vitest-environment node
/**
 * Contract tests for app/api/postman-auth/cookies.ts (audit M7):
 *   • the API-key cookie is stored encrypted but read back transparently
 *   • the postman_user cookie is HMAC-signed; tampering → treated as absent
 *   • legacy un-encrypted cookies keep working (soft migration)
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildApiKeyCookie,
  buildClearCookies,
  buildUserCookie,
  getApiKeyFromRequest,
  getUserFromRequest,
} from "../cookies";
import { signCookieValue } from "@/lib/crypto/cookie-cipher";

const SECRET = "unit-test-cookie-secret-0123456789abcdef";
const SAVED = process.env.COOKIE_SECRET;

beforeEach(() => {
  process.env.COOKIE_SECRET = SECRET;
});

afterEach(() => {
  if (SAVED === undefined) delete process.env.COOKIE_SECRET;
  else process.env.COOKIE_SECRET = SAVED;
});

function makeRequest(cookies: Record<string, string>) {
  return {
    cookies: {
      get(name: string) {
        return cookies[name] ? { value: cookies[name] } : undefined;
      },
    },
  };
}

describe("postman-auth cookie helpers", () => {
  it("roundtrips an encrypted API-key cookie", () => {
    const cookie = buildApiKeyCookie("PMAK-roundtrip");
    expect(cookie.value).not.toBe("PMAK-roundtrip");
    const request = makeRequest({ [cookie.name]: cookie.value });
    expect(getApiKeyFromRequest(request)).toBe("PMAK-roundtrip");
  });

  it("still reads legacy plaintext key cookies", () => {
    const request = makeRequest({ postman_api_key: "PMAK-legacy" });
    expect(getApiKeyFromRequest(request)).toBe("PMAK-legacy");
  });

  it("returns null for a corrupted key cookie", () => {
    const request = makeRequest({ postman_api_key: "v1.bad.bad.bad" });
    expect(getApiKeyFromRequest(request)).toBeNull();
  });

  it("roundtrips a signed user cookie and rejects forged ones", () => {
    const cookie = buildUserCookie({ username: "alice", email: "alice@example.com" });
    const ok = getUserFromRequest(makeRequest({ postman_user: cookie.value }));
    expect(ok).toEqual({ username: "alice", email: "alice@example.com" });

    // Forged payload reusing the original signature.
    const dot = cookie.value.indexOf(".");
    const forged = `${Buffer.from(JSON.stringify({ username: "admin" })).toString("base64url")}.${cookie.value.slice(dot + 1)}`;
    expect(getUserFromRequest(makeRequest({ postman_user: forged }))).toBeNull();

    // Tampered signature on the original payload.
    const sig = cookie.value.slice(dot + 1);
    const tampered = `${cookie.value.slice(0, dot)}.${(sig[0] === "A" ? "B" : "A") + sig.slice(1)}`;
    expect(getUserFromRequest(makeRequest({ postman_user: tampered }))).toBeNull();
  });

  it("rejects unsigned legacy user cookies (previously falsifiable)", () => {
    const request = makeRequest({ postman_user: JSON.stringify({ username: "mallory" }) });
    expect(getUserFromRequest(request)).toBeNull();
  });

  it("accepts plain.-prefixed values when no secret is configured", () => {
    delete process.env.COOKIE_SECRET;
    const signed = signCookieValue(JSON.stringify({ username: "dev" }));
    const request = makeRequest({ postman_user: signed });
    expect(getUserFromRequest(request)).toEqual({ username: "dev" });
  });

  it("clear cookies reset both names with maxAge 0", () => {
    const cleared = buildClearCookies();
    expect(cleared.map((c) => c.name)).toEqual(["postman_api_key", "postman_user"]);
    for (const cookie of cleared) {
      expect(cookie.maxAge).toBe(0);
      expect(cookie.httpOnly).toBe(true);
    }
  });
});

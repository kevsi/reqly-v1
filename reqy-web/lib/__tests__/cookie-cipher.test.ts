// @vitest-environment node
/**
 * Tests for lib/crypto/cookie-cipher (audit M7 — API keys at rest in cookies).
 *
 * Covers: AES-256-GCM roundtrip, tamper detection, wrong-secret rejection,
 * `plain.` fallback when no secret env var exists, legacy un-prefixed cookie
 * migration, and HMAC signing/verification of the postman_user payload.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  decryptCookieValue,
  encryptCookieValue,
  isCookieEncryptionAvailable,
  signCookieValue,
  verifySignedCookieValue,
} from "@/lib/crypto/cookie-cipher";

const SECRET_ENV_VARS = ["COOKIE_SECRET", "PROXY_SERVICE_TOKEN", "AUTH_SIGNING_SECRET"] as const;
const SECRET = ["unit", "test", "cookie", "secret", "0123456789abcdef"].join("-");
const OTHER_SECRET = ["another", "unit", "test", "cookie", "secret", "fedcba9876543210"].join("-");
const API_KEY = ["PMAK", "abc123DEF456ghi789"].join("-");

let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = {};
  for (const name of SECRET_ENV_VARS) {
    savedEnv[name] = process.env[name];
    delete process.env[name];
  }
});

afterEach(() => {
  for (const name of SECRET_ENV_VARS) {
    const value = savedEnv[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("encryptCookieValue / decryptCookieValue", () => {
  it("roundtrips an API key through AES-256-GCM", () => {
    process.env.COOKIE_SECRET = SECRET;
    const encrypted = encryptCookieValue(API_KEY);
    expect(encrypted).not.toBe(API_KEY);
    expect(decryptCookieValue(encrypted)).toBe(API_KEY);
  });

  it("uses the documented v1.<iv>.<tag>.<ct> base64url format", () => {
    process.env.COOKIE_SECRET = SECRET;
    const encrypted = encryptCookieValue(API_KEY);
    expect(encrypted.startsWith("v1.")).toBe(true);
    const parts = encrypted.slice(3).split(".");
    expect(parts).toHaveLength(3);
    for (const part of parts) {
      expect(part).toMatch(/^[A-Za-z0-9_-]+$/); // base64url alphabet only
      expect(part.length).toBeGreaterThan(0);
    }
  });

  it("produces distinct ciphertexts for the same input (random IV)", () => {
    process.env.COOKIE_SECRET = SECRET;
    const a = encryptCookieValue(API_KEY);
    const b = encryptCookieValue(API_KEY);
    expect(a).not.toBe(b);
    expect(decryptCookieValue(a)).toBe(API_KEY);
    expect(decryptCookieValue(b)).toBe(API_KEY);
  });

  it("returns null on a tampered ciphertext byte", () => {
    process.env.COOKIE_SECRET = SECRET;
    const encrypted = encryptCookieValue(API_KEY);
    const [iv, tag, ct] = encrypted.slice(3).split(".");
    // Flip one character inside the ciphertext part.
    const flipped = (ct[0] === "A" ? "B" : "A") + ct.slice(1);
    expect(decryptCookieValue(`v1.${iv}.${tag}.${flipped}`)).toBeNull();
  });

  it("returns null on a tampered auth tag", () => {
    process.env.COOKIE_SECRET = SECRET;
    const encrypted = encryptCookieValue(API_KEY);
    const [iv, tag, ct] = encrypted.slice(3).split(".");
    const flippedTag = (tag[0] === "A" ? "B" : "A") + tag.slice(1);
    expect(decryptCookieValue(`v1.${iv}.${flippedTag}.${ct}`)).toBeNull();
  });

  it("returns null on malformed v1 payloads", () => {
    process.env.COOKIE_SECRET = SECRET;
    expect(decryptCookieValue("v1.only-two.parts")).toBeNull();
    expect(decryptCookieValue("v1...")).toBeNull();
    expect(decryptCookieValue("v1.nonsense")).toBeNull();
  });

  it("returns null when decrypted with a different secret", () => {
    process.env.COOKIE_SECRET = SECRET;
    const encrypted = encryptCookieValue(API_KEY);
    process.env.COOKIE_SECRET = OTHER_SECRET;
    expect(decryptCookieValue(encrypted)).toBeNull();
  });

  it("supports PROXY_SERVICE_TOKEN then AUTH_SIGNING_SECRET fallbacks", () => {
    process.env.PROXY_SERVICE_TOKEN = SECRET;
    const viaProxyToken = encryptCookieValue(API_KEY);
    expect(decryptCookieValue(viaProxyToken)).toBe(API_KEY);

    delete process.env.PROXY_SERVICE_TOKEN;
    process.env.AUTH_SIGNING_SECRET = OTHER_SECRET;
    expect(isCookieEncryptionAvailable()).toBe(true);
    const viaAuthSecret = encryptCookieValue(API_KEY);
    expect(decryptCookieValue(viaAuthSecret)).toBe(API_KEY);
    // Keys are purpose-derived: a secret swap invalidates old payloads.
    expect(decryptCookieValue(viaProxyToken)).toBeNull();
  });
});

describe("plain fallback (no secret configured)", () => {
  it("encrypts transparently with a plain. prefix when no secret exists", () => {
    expect(isCookieEncryptionAvailable()).toBe(false);
    const stored = encryptCookieValue(API_KEY);
    expect(stored.startsWith("plain.")).toBe(true);
    expect(stored.endsWith(API_KEY)).toBe(true);
    expect(decryptCookieValue(stored)).toBe(API_KEY);
  });

  it("cannot decrypt v1 payloads when no secret is configured", () => {
    process.env.COOKIE_SECRET = SECRET;
    const encrypted = encryptCookieValue(API_KEY);
    for (const name of SECRET_ENV_VARS) delete process.env[name];
    expect(decryptCookieValue(encrypted)).toBeNull();
  });
});

describe("legacy cookie migration", () => {
  it("passes un-prefixed plaintext values through unchanged", () => {
    process.env.COOKIE_SECRET = SECRET;
    expect(decryptCookieValue(API_KEY)).toBe(API_KEY);
    expect(decryptCookieValue("jina_abc123")).toBe("jina_abc123");
  });

  it("treats empty and missing inputs defensively", () => {
    process.env.COOKIE_SECRET = SECRET;
    expect(encryptCookieValue("")).toBe("");
    expect(decryptCookieValue(null)).toBeNull();
    expect(decryptCookieValue(undefined)).toBeNull();
    expect(decryptCookieValue("")).toBeNull();
  });
});

describe("signCookieValue / verifySignedCookieValue", () => {
  it("roundtrips a signed user payload", () => {
    process.env.COOKIE_SECRET = SECRET;
    const payload = JSON.stringify({ username: "alice", email: "alice@example.com" });
    const signed = signCookieValue(payload);
    expect(signed).not.toBe(payload);
    expect(signed.includes(".")).toBe(true);
    expect(verifySignedCookieValue(signed)).toBe(payload);
  });

  it("returns null on a forged payload", () => {
    process.env.COOKIE_SECRET = SECRET;
    const signed = signCookieValue(JSON.stringify({ username: "alice" }));
    const dot = signed.indexOf(".");
    const forgedPayload = Buffer.from(
      JSON.stringify({ username: "admin", email: "root@example.com" }),
    ).toString("base64url");
    expect(verifySignedCookieValue(`${forgedPayload}.${signed.slice(dot + 1)}`)).toBeNull();
  });

  it("returns null on a tampered signature", () => {
    process.env.COOKIE_SECRET = SECRET;
    const signed = signCookieValue(JSON.stringify({ username: "alice" }));
    const dot = signed.indexOf(".");
    const sig = signed.slice(dot + 1);
    const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
    expect(verifySignedCookieValue(`${signed.slice(0, dot)}.${flipped}`)).toBeNull();
  });

  it("returns null when verified with a different secret", () => {
    process.env.COOKIE_SECRET = SECRET;
    const signed = signCookieValue(JSON.stringify({ username: "alice" }));
    process.env.COOKIE_SECRET = OTHER_SECRET;
    expect(verifySignedCookieValue(signed)).toBeNull();
  });

  it("falls back to plain. storage when no secret exists", () => {
    const signed = signCookieValue(JSON.stringify({ username: "alice" }));
    expect(signed.startsWith("plain.")).toBe(true);
    expect(verifySignedCookieValue(signed)).toBe('{"username":"alice"}');
  });

  it("returns null for unsigned or corrupt inputs", () => {
    process.env.COOKIE_SECRET = SECRET;
    expect(verifySignedCookieValue(null)).toBeNull();
    expect(verifySignedCookieValue(undefined)).toBeNull();
    expect(verifySignedCookieValue("")).toBeNull();
    expect(verifySignedCookieValue("no-dot-here")).toBeNull();
    expect(signCookieValue("")).toBe("");
  });
});

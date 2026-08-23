import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * At-rest protection for API-key cookies (jina_api_key / postman_api_key /
 * postman_user). Audit M7: these cookies used to hold plaintext keys for 30d.
 *
 * Formats:
 *   encrypted value : `v1.<iv-b64url>.<tag-b64url>.<ct-b64url>`   (AES-256-GCM)
 *   signed value    : `<payload-b64url>.<hmac-b64url>`            (HMAC-SHA256)
 *   dev fallback    : `plain.<value>`                             (no secret configured)
 *
 * decrypt/verify are tolerant: a corrupted or tampered payload yields null and
 * legacy un-prefixed cookies (written before this module existed) pass through
 * unchanged for soft migration.
 */

const V1_PREFIX = "v1.";
const PLAIN_PREFIX = "plain.";
const HKDF_SALT = "reqly.cookie-cipher.v1";
const IV_BYTES = 12;
const KEY_BYTES = 32;

function resolveSecretMaterial(): Buffer | null {
  const raw =
    process.env.COOKIE_SECRET ||
    process.env.PROXY_SERVICE_TOKEN ||
    process.env.AUTH_SIGNING_SECRET ||
    "";
  const material = raw.trim();
  return material ? Buffer.from(material, "utf8") : null;
}

interface DerivedKeys {
  enc: Buffer;
  mac: Buffer;
}

function deriveKeys(): DerivedKeys | null {
  const ikm = resolveSecretMaterial();
  if (!ikm) return null;
  // Fresh derivation per call (HKDF is cheap) keeps tests that mutate
  // process.env deterministic without exposing a reset hook.
  const enc = Buffer.from(hkdfSync("sha256", ikm, HKDF_SALT, "aes-256-gcm", KEY_BYTES));
  const mac = Buffer.from(hkdfSync("sha256", ikm, HKDF_SALT, "hmac-sha256", KEY_BYTES));
  return { enc, mac };
}

export function isCookieEncryptionAvailable(): boolean {
  return resolveSecretMaterial() !== null;
}

function toB64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function fromB64url(value: string): Buffer | null {
  if (!value) return null;
  const buf = Buffer.from(value, "base64url");
  return buf.length > 0 ? buf : null;
}

/** Encrypt a cookie value; falls back to `plain.` prefix when no secret exists. */
export function encryptCookieValue(value: string): string {
  if (!value) return value;
  const keys = deriveKeys();
  if (!keys) return `${PLAIN_PREFIX}${value}`;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keys.enc, iv);
  const ct = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${V1_PREFIX}${toB64url(iv)}.${toB64url(tag)}.${toB64url(ct)}`;
}

/**
 * Decrypt a cookie value produced by encryptCookieValue.
 * Returns null when an encrypted payload is malformed or fails authentication.
 * Legacy un-prefixed values are returned as-is (soft migration).
 */
export function decryptCookieValue(value: string | undefined | null): string | null {
  if (!value) return null;
  if (value.startsWith(V1_PREFIX)) {
    const keys = deriveKeys();
    if (!keys) return null;
    const parts = value.slice(V1_PREFIX.length).split(".");
    if (parts.length !== 3) return null;
    const iv = fromB64url(parts[0]);
    const tag = fromB64url(parts[1]);
    const ct = fromB64url(parts[2]);
    if (!iv || !tag || !ct || iv.length !== IV_BYTES) return null;
    try {
      const decipher = createDecipheriv("aes-256-gcm", keys.enc, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
    } catch {
      return null;
    }
  }
  if (value.startsWith(PLAIN_PREFIX)) return value.slice(PLAIN_PREFIX.length);
  return value;
}

/** Sign a cookie value; falls back to unsigned `plain.` when no secret exists. */
export function signCookieValue(value: string): string {
  if (!value) return value;
  const keys = deriveKeys();
  if (!keys) return `${PLAIN_PREFIX}${value}`;
  const payload = toB64url(Buffer.from(value, "utf8"));
  const sig = createHmac("sha256", keys.mac).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

/**
 * Verify a signed cookie value and return its original content.
 * Returns null when the signature is missing/invalid or the payload is corrupt.
 */
export function verifySignedCookieValue(signed: string | undefined | null): string | null {
  if (!signed) return null;
  if (signed.startsWith(PLAIN_PREFIX)) return signed.slice(PLAIN_PREFIX.length);
  const dot = signed.indexOf(".");
  if (dot <= 0) return null;
  const keys = deriveKeys();
  if (!keys) return null;
  const payload = signed.slice(0, dot);
  const sig = signed.slice(dot + 1);
  const expected = createHmac("sha256", keys.mac).update(payload).digest();
  const actual = Buffer.from(sig, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return null;
  }
  try {
    const decoded = Buffer.from(payload, "base64url").toString("utf8");
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Webhook endpoint secrets are never stored in plaintext: a DB dump (backup,
 * Litestream replica) must not let an attacker forge events on every user's
 * public hook URL. Same keyed-HMAC pattern as the verification codes, with a
 * domain prefix so the digest can never be confused with another HMAC domain.
 *
 * Stored form: `hmac:<hex>` — the prefix makes the boot migration idempotent
 * (plaintext rows are exactly the ones without it).
 */
const PREFIX = "hmac:";

export function isHashedSecret(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function hashWebhookSecret(plain: string): string {
  const secret = process.env.AUTH_SIGNING_SECRET || "dev-insecure";
  const digest = createHmac("sha256", secret)
    .update(`reqly:webhook-secret:v1:${plain}`, "utf8")
    .digest("hex");
  return `${PREFIX}${digest}`;
}

/** Constant-time comparison of a plaintext candidate against a stored hash. */
export function verifyWebhookSecret(plain: string, stored: string): boolean {
  const candidate = Buffer.from(hashWebhookSecret(plain));
  const expected = Buffer.from(stored);
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

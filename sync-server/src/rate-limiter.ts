/**
 * Lightweight in-memory rate limiter for the sync-server.
 *
 * Uses a sliding-window approach per key. Designed for single-process
 * deployments (development, single-instance production). For multi-instance
 * deployments, swap in an external store (Redis, etc.).
 *
 * The default limits are generous to avoid breaking legitimate usage while
 * still providing a basic defence-in-depth layer against runaway clients or
 * accidental loops.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export interface RateLimiterOptions {
  windowMs: number;
  maxRequests: number;
}

interface Entry {
  count: number;
  resetAt: number;
}

export class InMemoryRateLimiter {
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly entries = new Map<string, Entry>();
  private readonly cleanupTimer: ReturnType<typeof setInterval> | undefined;

  constructor(opts: RateLimiterOptions) {
    this.windowMs = opts.windowMs;
    this.maxRequests = opts.maxRequests;

    // Sweep stale entries every 5 minutes
    const cleanupIntervalMs = 300_000;
    this.cleanupTimer = setInterval(() => this.sweep(), cleanupIntervalMs);
    if (
      this.cleanupTimer &&
      typeof this.cleanupTimer === "object" &&
      "unref" in this.cleanupTimer
    ) {
      (this.cleanupTimer as { unref?: () => void }).unref?.();
    }
  }

  check(key: string): RateLimitResult {
    const now = Date.now();
    let entry = this.entries.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + this.windowMs };
      this.entries.set(key, entry);
    }
    entry.count++;
    return {
      allowed: entry.count <= this.maxRequests,
      remaining: Math.max(0, this.maxRequests - entry.count),
      resetAt: entry.resetAt,
    };
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= now) {
        this.entries.delete(key);
      }
    }
  }

  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
  }
}

/**
 * Pre-built rate limiters used by the sync-server routes.
 *
 * Default limits (per IP, per window):
 *   - API:    120 req / 60 s
 *   - Auth:    20 req / 60 s  (login/register)
 *   - Sync:    60 req / 60 s  (poll/push — bursty but bounded)
 *   - Sync:    60 req / 60 s  (poll/push — bursty but bounded)
 *   - WS:      10 conn / 60 s (WebSocket upgrade)
 *   - Hook:   100 req / 60 s  (public webhook ingest — must be bounded)
 *
 * 🔐 SECURITY: Webhook rate limiting is critical to prevent DB exhaustion
 * from DoS attacks on public endpoints. Increased from 60 to 100 req/min
 * to accommodate webhook bursts while still protecting against abuse.
 */
export const apiLimiter = new InMemoryRateLimiter({ windowMs: 60_000, maxRequests: 120 });
export const authLimiter = new InMemoryRateLimiter({ windowMs: 60_000, maxRequests: 20 });
export const syncLimiter = new InMemoryRateLimiter({ windowMs: 60_000, maxRequests: 60 });
export const wsLimiter = new InMemoryRateLimiter({ windowMs: 60_000, maxRequests: 10 });
export const hookLimiter = new InMemoryRateLimiter({ windowMs: 60_000, maxRequests: 100 });

/**
 * Hono middleware that checks the rate limiter for the client IP.
 * Returns 429 if the limit is exceeded.
 */
import type { Context, Next } from "hono";

/**
 * Resolve the client IP without trusting spoofable headers.
 *
 * `x-forwarded-for` / `x-real-ip` are plain client-supplied headers: an
 * attacker can set them to anything, so bucketing by them would let a client
 * bypass the limiter with a rotating value. Only when the deployment sits
 * behind a trusted reverse proxy (which overwrites these headers) should we
 * read them — opt in via TRUSTED_PROXY=true. Otherwise fall back to the
 * socket address, which the client cannot forge.
 */
const TRUSTED_PROXY = (): boolean => process.env.TRUSTED_PROXY === "true";

export function clientIp(c: Context): string {
  if (TRUSTED_PROXY()) {
    return (
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
      c.req.header("x-real-ip") ||
      "unknown"
    );
  }
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)
    ?.incoming;
  return incoming?.socket?.remoteAddress ?? "unknown";
}

export function rateLimitMiddleware(limiter: InMemoryRateLimiter) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const ip = clientIp(c);
    const result = limiter.check(`ip:${ip}`);
    if (!result.allowed) {
      return c.json({ error: "Too many requests. Please slow down." }, 429, {
        "Retry-After": String(Math.ceil((result.resetAt - Date.now()) / 1000)),
        "X-RateLimit-Remaining": "0",
      });
    }
    c.header("X-RateLimit-Remaining", String(result.remaining));
    return next();
  };
}

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { InMemoryRateLimiter, UpstashRateLimiter, createRateLimiter } from "@/lib/rate-limiter";

describe("InMemoryRateLimiter", () => {
  const limiters: InMemoryRateLimiter[] = [];

  function makeLimiter(maxRequests = 3, windowMs = 60_000): InMemoryRateLimiter {
    const limiter = new InMemoryRateLimiter({ windowMs, maxRequests });
    limiters.push(limiter);
    return limiter;
  }

  afterEach(() => {
    while (limiters.length > 0) {
      const limiter = limiters.pop();
      limiter?.dispose();
    }
  });

  it("allows requests under the limit", () => {
    const limiter = makeLimiter(3);

    const first = limiter.check("user-a");
    const second = limiter.check("user-a");
    const third = limiter.check("user-a");

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(true);
  });

  it("blocks requests once the limit is exceeded", () => {
    const limiter = makeLimiter(2);

    expect(limiter.check("user-b").allowed).toBe(true);
    expect(limiter.check("user-b").allowed).toBe(true);
    const over = limiter.check("user-b");

    expect(over.allowed).toBe(false);
  });

  it("returns the correct remaining count", () => {
    const limiter = makeLimiter(5);

    expect(limiter.check("user-c").remaining).toBe(4);
    expect(limiter.check("user-c").remaining).toBe(3);
    expect(limiter.check("user-c").remaining).toBe(2);
    expect(limiter.check("user-c").remaining).toBe(1);
    expect(limiter.check("user-c").remaining).toBe(0);
  });

  it("clamps remaining to zero when over the limit", () => {
    const limiter = makeLimiter(1);

    limiter.check("user-d");
    const over = limiter.check("user-d");

    expect(over.remaining).toBe(0);
    expect(over.allowed).toBe(false);
  });

  it("isolates different keys", () => {
    const limiter = makeLimiter(1);

    const a1 = limiter.check("alpha");
    const b1 = limiter.check("beta");

    expect(a1.allowed).toBe(true);
    expect(b1.allowed).toBe(true);

    // Each key has its own bucket — exhausting one does not affect the other.
    const a2 = limiter.check("alpha");
    const b2 = limiter.check("beta");

    expect(a2.allowed).toBe(false);
    expect(b2.allowed).toBe(false);
  });

  describe("createRateLimiter", () => {
    const OLD_ENV = process.env;

    beforeEach(() => {
      vi.resetModules();
      process.env = { ...OLD_ENV };
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;
    });

    afterEach(() => {
      process.env = OLD_ENV;
    });

    it("returns InMemoryRateLimiter when no Upstash env vars are set", () => {
      const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 10 });
      expect(limiter).toBeInstanceOf(InMemoryRateLimiter);
    });

    it("returns InMemoryRateLimiter when only URL is set (no token)", () => {
      process.env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.io";
      const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 10 });
      expect(limiter).toBeInstanceOf(InMemoryRateLimiter);
    });

    it("returns UpstashRateLimiter when both URL and token are set", () => {
      process.env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.io";
      process.env.UPSTASH_REDIS_REST_TOKEN = "secret";
      const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 10 });
      expect(limiter).toBeInstanceOf(UpstashRateLimiter);
    });

    it("preserves windowMs and maxRequests in the result", () => {
      const limiter = createRateLimiter({ windowMs: 30_000, maxRequests: 5 });
      expect(limiter).toBeInstanceOf(InMemoryRateLimiter);
      // InMemoryRateLimiter can be exercised synchronously
      const result = limiter.check("test-key") as ReturnType<InMemoryRateLimiter["check"]>;
      // Since InMemoryRateLimiter returns sync, check directly
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
    });
  });

  it("resets the window after the time elapses", () => {
    const limiter = makeLimiter(1, 10);

    expect(limiter.check("user-e").allowed).toBe(true);
    expect(limiter.check("user-e").allowed).toBe(false);

    const resetAt = limiter.check("user-e").resetAt;

    // Advance the clock past the window.
    const originalNow = Date.now;
    Date.now = () => resetAt + 1;
    try {
      expect(limiter.check("user-e").allowed).toBe(true);
    } finally {
      Date.now = originalNow;
    }
  });
});

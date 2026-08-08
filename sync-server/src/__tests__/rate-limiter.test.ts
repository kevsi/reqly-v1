import { describe, it, expect, afterEach } from "vitest";
import { Hono } from "hono";
import {
  InMemoryRateLimiter,
  authLimiter,
  clientIp,
  rateLimitMiddleware,
} from "../rate-limiter.js";

afterEach(() => {
  delete process.env.TRUSTED_PROXY;
});

function stubContext(headers: Record<string, string>, remoteAddress?: string) {
  return {
    req: { header: (name: string) => headers[name.toLowerCase()] ?? undefined },
    env: remoteAddress ? { incoming: { socket: { remoteAddress } } } : {},
  } as Parameters<typeof clientIp>[0];
}

describe("clientIp", () => {
  it("does not trust spoofable x-forwarded-for unless TRUSTED_PROXY=true", () => {
    const c = stubContext({ "x-forwarded-for": "1.2.3.4" }, "127.0.0.1");
    expect(clientIp(c)).toBe("127.0.0.1");
  });

  it("uses x-forwarded-for when behind a trusted proxy", () => {
    process.env.TRUSTED_PROXY = "true";
    const c = stubContext({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" });
    expect(clientIp(c)).toBe("1.2.3.4");
  });
});

describe("authLimiter", () => {
  it("blocks the 21st auth request within the window", async () => {
    const app = new Hono();
    app.use("/api/auth/*", rateLimitMiddleware(authLimiter));
    app.post("/api/auth/login", (c) => c.json({ ok: true }));

    let blocked = false;
    for (let i = 0; i < 21; i++) {
      const res = await app.request("/api/auth/login", { method: "POST" });
      if (res.status === 429) blocked = true;
    }
    expect(blocked).toBe(true);
  });
});

describe("InMemoryRateLimiter", () => {
  it("resets after the window elapses", () => {
    const limiter = new InMemoryRateLimiter({ windowMs: 20, maxRequests: 1 });
    expect(limiter.check("k").allowed).toBe(true);
    expect(limiter.check("k").allowed).toBe(false);
    return new Promise((resolve) => {
      setTimeout(() => {
        expect(limiter.check("k").allowed).toBe(true);
        limiter.dispose();
        resolve(null);
      }, 30);
    });
  });
});

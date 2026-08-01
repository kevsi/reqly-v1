import { describe, it, expect, vi } from "vitest"
import { UpstashRateLimiter } from "@/lib/rate-limiter"

describe("UpstashRateLimiter", () => {
  it("parses a successful Upstash response and surfaces success=true", async () => {
    const limiter = new UpstashRateLimiter({
      url: "https://fake.upstash.io",
      token: "token",
      windowMs: 60_000,
      maxRequests: 100,
    })
    // Stub global fetch
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, limit: 100, remaining: 99, reset: 1700000000 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )
    const r = await limiter.check("user-a")
    expect(r.allowed).toBe(true)
    expect(r.remaining).toBe(99)
    expect(r.resetAt).toBe(1700000000 * 1000)
    expect(fetchSpy).toHaveBeenCalledOnce()
    fetchSpy.mockRestore()
  })

  it("parses a rate-limited Upstash response (success=false)", async () => {
    const limiter = new UpstashRateLimiter({
      url: "https://fake.upstash.io",
      token: "token",
      windowMs: 60_000,
      maxRequests: 100,
    })
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false, limit: 100, remaining: 0, reset: 1700000000 }), {
        status: 200,
      }),
    )
    const r = await limiter.check("user-a")
    expect(r.allowed).toBe(false)
    expect(r.remaining).toBe(0)
    fetchSpy.mockRestore()
  })

  it("fails OPEN on network error (does NOT block legitimate traffic)", async () => {
    const limiter = new UpstashRateLimiter({
      url: "https://unreachable.invalid",
      token: "token",
      windowMs: 60_000,
      maxRequests: 1,
    })
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("ECONNREFUSED"))
    const r = await limiter.check("user-a")
    expect(r.allowed).toBe(true)
    expect(r.remaining).toBe(1)
    fetchSpy.mockRestore()
  })

  it("fails OPEN on non-OK HTTP response (5xx)", async () => {
    const limiter = new UpstashRateLimiter({
      url: "https://fake.upstash.io",
      token: "token",
      windowMs: 60_000,
      maxRequests: 1,
    })
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 503 }),
    )
    const r = await limiter.check("user-a")
    expect(r.allowed).toBe(true)
    fetchSpy.mockRestore()
  })

  it("converts windowMs to seconds in the Upstash payload", async () => {
    const limiter = new UpstashRateLimiter({
      url: "https://fake.upstash.io",
      token: "token",
      windowMs: 120_000, // 2 minutes
      maxRequests: 50,
    })
    let capturedBody = ""
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementationOnce(async (_url, init) => {
      capturedBody = String(init?.body ?? "")
      return new Response(JSON.stringify({ success: true, limit: 50, remaining: 49, reset: 0 }), { status: 200 })
    })
    await limiter.check("user-a")
    const payload = JSON.parse(capturedBody)
    expect(payload.window).toBe("120s")
    expect(payload.limit).toBe(50)
    expect(payload.algorithm).toBe("sliding_window")
    fetchSpy.mockRestore()
  })
})

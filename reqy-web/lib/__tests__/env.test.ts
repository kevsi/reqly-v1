import { describe, it, expect, beforeEach, vi } from "vitest"

/**
 * env.ts caches its parsed schemas at module scope (`cachedServerEnv`,
 * `cachedPublicEnv`). To test different process.env values per case we
 * MUST reset the module between tests — otherwise the cache from a prior
 * test will be returned regardless of subsequent env changes.
 *
 * `vi.resetModules()` clears the module registry so the next dynamic
 * `await import(...)` returns a fresh module instance with fresh state.
 *
 * Note: env.ts also has a `warnedEdge` flag that latches to true after the
 * first Edge warning. This is fine — `vi.resetModules()` also resets that.
 */
describe("lib/env", () => {
  beforeEach(() => {
    vi.resetModules()
    // Clean baseline so each test starts from a known state.
    delete process.env.AUTH_SIGNING_SECRET
    delete process.env.NEXT_PUBLIC_APP_URL
  })

  it("validateBuildTimeEnv: no-op (current behaviour)", async () => {
    // As of the v0.2.0-security-hardening revert, validateBuildTimeEnv
    // intentionally throws nothing because auth is disabled and there are
    // no other required server-side env vars. This test locks in the
    // current contract — change it back to an assertion of missing-var
    // error when auth is re-enabled.
    const { validateBuildTimeEnv } = await import("../env")
    expect(() => validateBuildTimeEnv()).not.toThrow()
  })

  it("getServerEnv: returns parsed env without requiring AUTH_SIGNING_SECRET", async () => {
    // AUTH_SIGNING_SECRET is now optional in the schema (auth disabled).
    const { getServerEnv } = await import("../env")
    const env = getServerEnv()
    expect(env).toBeDefined()
    expect(env.AUTH_SIGNING_SECRET).toBeUndefined()
  })

  it("getServerEnv: accepts AUTH_SIGNING_SECRET when present (any length)", async () => {
    process.env.AUTH_SIGNING_SECRET = "short"
    const { getServerEnv } = await import("../env")
    const env = getServerEnv()
    expect(env.AUTH_SIGNING_SECRET).toBe("short")
  })

  it("getServerEnv: caches after first call (returns same instance)", async () => {
    process.env.AUTH_SIGNING_SECRET = "a".repeat(40)
    const { getServerEnv } = await import("../env")
    const a = getServerEnv()
    const b = getServerEnv()
    expect(a).toBe(b)
    expect(a.AUTH_SIGNING_SECRET).toHaveLength(40)
  })

  it("getServerEnv: returns fresh instance after vi.resetModules()", async () => {
    process.env.AUTH_SIGNING_SECRET = "first-value"
    const { getServerEnv: get1 } = await import("../env")
    const first = get1()

    // Mutate process.env, reset module, re-import.
    process.env.AUTH_SIGNING_SECRET = "second-value"
    vi.resetModules()
    const { getServerEnv: get2 } = await import("../env")
    const second = get2()

    expect(first).not.toBe(second)
    expect(first.AUTH_SIGNING_SECRET).toBe("first-value")
    expect(second.AUTH_SIGNING_SECRET).toBe("second-value")
  })

  it("getServerEnv: short-circuits on Edge runtime without throwing", async () => {
    process.env.NEXT_RUNTIME = "edge"
    delete process.env.AUTH_SIGNING_SECRET
    const { getServerEnv } = await import("../env")
    // On Edge, the validator is skipped — env returned as-is.
    const env = getServerEnv()
    expect(env).toBeDefined()
    delete process.env.NEXT_RUNTIME
  })

  it("getPublicEnv: defaults NEXT_PUBLIC_APP_URL when missing", async () => {
    delete process.env.NEXT_PUBLIC_APP_URL
    const { getPublicEnv } = await import("../env")
    const env = getPublicEnv()
    expect(env.NEXT_PUBLIC_APP_URL).toBe("http://localhost:3000")
  })

  it("getPublicEnv: rejects malformed URL", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "not-a-url"
    const { getPublicEnv } = await import("../env")
    expect(() => getPublicEnv()).toThrow(/invalid public environment/)
  })
})

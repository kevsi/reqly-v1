import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { validatePostmanApiKey, PostmanApiError } from "@/lib/postman"

describe("validatePostmanApiKey", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function mockFetchOnce(response: { ok: boolean; status?: number; body: unknown }) {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 401),
      json: () => Promise.resolve(response.body),
    } as Response)
  }

  it("returns user on 200 with user.username shape", async () => {
    mockFetchOnce({
      ok: true,
      body: { user: { username: "alice", email: "alice@example.com" } },
    })
    const user = await validatePostmanApiKey("PMAK-test")
    expect(user).toEqual({ username: "alice", email: "alice@example.com" })
  })

  it("returns user on 200 with flat username shape (fallback)", async () => {
    mockFetchOnce({
      ok: true,
      body: { username: "bob", email: "bob@example.com" },
    })
    const user = await validatePostmanApiKey("PMAK-test")
    expect(user).toEqual({ username: "bob", email: "bob@example.com" })
  })

  it("throws PostmanApiError on 401 with Postman's message", async () => {
    mockFetchOnce({
      ok: false,
      status: 401,
      body: { error: { message: "Invalid API Key. Every request requires a valid API Key to be sent." } },
    })
    await expect(validatePostmanApiKey("PMAK-bad")).rejects.toThrow(/Invalid API Key/)
  })

  it("throws PostmanApiError on 403", async () => {
    mockFetchOnce({ ok: false, status: 403, body: { message: "Forbidden" } })
    await expect(validatePostmanApiKey("PMAK-x")).rejects.toThrow(PostmanApiError)
  })

  it("throws PostmanApiError with rate limit message on 429", async () => {
    mockFetchOnce({ ok: false, status: 429, body: {} })
    await expect(validatePostmanApiKey("PMAK-x")).rejects.toThrow(/Limite de requêtes/)
  })

  it("throws PostmanApiError on network error", async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error("network"))
    await expect(validatePostmanApiKey("PMAK-test")).rejects.toThrow(PostmanApiError)
    await expect(validatePostmanApiKey("PMAK-test")).rejects.toThrow(/Erreur réseau/)
  })

  it("passes an AbortSignal to fetch (timeout support)", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ user: { username: "x" } }),
    } as Response)
    global.fetch = fetchMock
    await validatePostmanApiKey("PMAK-test")
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.postman.com/me",
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      })
    )
  })

  it("uses X-API-Key header with the provided key", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ user: { username: "x" } }),
    } as Response)
    global.fetch = fetchMock
    await validatePostmanApiKey("PMAK-my-key")
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.postman.com/me",
      expect.objectContaining({
        headers: expect.objectContaining({ "X-API-Key": "PMAK-my-key" }),
      })
    )
  })

  it("uses Accept: application/vnd.api.v10+json header (v10 API)", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ user: { username: "x" } }),
    } as Response)
    global.fetch = fetchMock
    await validatePostmanApiKey("PMAK-test")
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.postman.com/me",
      expect.objectContaining({
        headers: expect.objectContaining({ Accept: "application/vnd.api.v10+json" }),
      })
    )
  })

  it("includes a User-Agent header", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ user: { username: "x" } }),
    } as Response)
    global.fetch = fetchMock
    await validatePostmanApiKey("PMAK-test")
    const call = fetchMock.mock.calls[0][1] as { headers: Record<string, string> }
    expect(call.headers["User-Agent"]).toBeDefined()
  })
})

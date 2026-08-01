import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { postmanFetch, postmanFetchJson, PostmanApiError } from "@/lib/postman"

describe("postmanFetch", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("targets api.postman.com domain", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    } as Response)
    global.fetch = fetchMock
    await postmanFetch("PMAK-test", "/me")
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.postman.com/me",
      expect.any(Object)
    )
  })

  it("adds X-API-Key, Accept v10, User-Agent headers", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    } as Response)
    global.fetch = fetchMock
    await postmanFetch("PMAK-my-key", "/collections")
    const callArgs = fetchMock.mock.calls[0][1] as { headers: Record<string, string> }
    expect(callArgs.headers["X-API-Key"]).toBe("PMAK-my-key")
    expect(callArgs.headers["Accept"]).toBe("application/vnd.api.v10+json")
    expect(callArgs.headers["User-Agent"]).toBeDefined()
  })

  it("merges custom headers from options", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    } as Response)
    global.fetch = fetchMock
    await postmanFetch("PMAK-x", "/x", {
      headers: { "Content-Type": "application/json" },
    })
    const callArgs = fetchMock.mock.calls[0][1] as { headers: Record<string, string> }
    expect(callArgs.headers["Content-Type"]).toBe("application/json")
    expect(callArgs.headers["X-API-Key"]).toBe("PMAK-x")
  })

  it("passes an AbortSignal", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    } as Response)
    global.fetch = fetchMock
    await postmanFetch("PMAK-x", "/x")
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })
})

describe("postmanFetchJson", () => {
  it("returns parsed JSON on 200", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ user: { username: "alice" } }),
    } as Response)
    const data = await postmanFetchJson<any>("PMAK-x", "/me")
    expect(data).toEqual({ user: { username: "alice" } })
  })

  it("throws PostmanApiError with status on 401", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: { message: "Invalid API Key" } }),
    } as Response)
    await expect(postmanFetchJson("PMAK-bad", "/me")).rejects.toThrow(PostmanApiError)
    await expect(postmanFetchJson("PMAK-bad", "/me")).rejects.toThrow(/Invalid API Key/)
  })

  it("throws PostmanApiError with status on 500 with generic message", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error("not json")),
    } as Response)
    await expect(postmanFetchJson("PMAK-x", "/x")).rejects.toThrow(/HTTP 500/)
  })
})

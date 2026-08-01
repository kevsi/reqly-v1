import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { introspectSchema, endpointHash, INTROSPECTION_QUERY_STRING } from "@/lib/graphql/introspect"

// Mock proxy-auth to avoid environment variable dependency
vi.mock("@/lib/proxy-auth", () => ({
  proxyAuthHeaders: () => ({ "x-proxy-token": "test-token" }),
}))

describe("introspectSchema", () => {
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn()) })
  afterEach(() => { vi.unstubAllGlobals() })

  it("POSTs introspection query via /api/proxy", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 200,
          body: JSON.stringify({ data: { __schema: { queryType: { name: "Query" } } } }),
          headers: {},
          durationMs: 42,
        }),
        { status: 200 },
      ),
    )

    await introspectSchema("https://api.example.com/graphql")

    expect(fetch).toHaveBeenCalledWith("/api/proxy", expect.any(Object))
    const callArgs = (vi.mocked(fetch).mock.calls[0][1] as RequestInit)
    expect(callArgs.method).toBe("POST")
    expect(callArgs.headers).toMatchObject({
      "Content-Type": "application/json",
      "x-proxy-token": "test-token",
    })
  })

  it("sends the endpoint URL and introspection query in the proxy body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 200,
          body: JSON.stringify({ data: { __schema: { queryType: { name: "Query" } } } }),
          headers: {},
          durationMs: 42,
        }),
        { status: 200 },
      ),
    )

    await introspectSchema("https://x")

    const callBody = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string)
    expect(callBody.url).toBe("https://x")
    expect(callBody.method).toBe("POST")
    expect(JSON.parse(callBody.body).query).toBe(INTROSPECTION_QUERY_STRING)
  })

  it("returns the JSON-stringified data field from the proxy response", async () => {
    const data = { __schema: { queryType: { name: "Query" } } }
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 200,
          body: JSON.stringify({ data }),
          headers: {},
          durationMs: 42,
        }),
        { status: 200 },
      ),
    )

    const sdl = await introspectSchema("https://x")
    expect(JSON.parse(sdl)).toEqual(data)
  })

  it("throws on proxy error response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Proxy rejected" }), { status: 403 }),
    )

    await expect(introspectSchema("https://x")).rejects.toThrow("Proxy rejected")
  })

  it("throws on non-JSON proxy response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("not json", { status: 500 }))

    await expect(introspectSchema("https://x")).rejects.toThrow()
  })
})

describe("endpointHash", () => {
  it("produces stable hash for same endpoint", () => {
    expect(endpointHash("https://x")).toBe(endpointHash("https://x"))
  })

  it("produces different hashes for different endpoints", () => {
    expect(endpointHash("https://x")).not.toBe(endpointHash("https://y"))
  })

  it("starts with 'gql-' prefix", () => {
    expect(endpointHash("https://x")).toMatch(/^gql-/)
  })
})

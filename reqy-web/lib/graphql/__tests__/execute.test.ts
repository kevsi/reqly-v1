import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { executeGraphQL } from "@/lib/graphql/execute"

function makeProxyResponse(opts: {
  status: number
  body: string
  durationMs?: number
}): Response {
  return new Response(
    JSON.stringify({
      status: opts.status,
      statusText: opts.status >= 200 && opts.status < 300 ? "OK" : "Error",
      body: opts.body,
      headers: { "content-type": "application/json" },
      durationMs: opts.durationMs ?? 120,
      size: opts.body.length,
      timings: { dnsMs: 5, connectMs: 10, ttfbMs: 100 },
    }),
    { status: opts.status >= 200 && opts.status < 300 ? 200 : opts.status },
  )
}

describe("executeGraphQL", () => {
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn()) })
  afterEach(() => { vi.unstubAllGlobals() })

  it("POSTs to /api/proxy with correct payload", async () => {
    const fetchMock = vi.mocked(fetch).mockResolvedValueOnce(
      makeProxyResponse({
        status: 200,
        body: JSON.stringify({ data: { user: { id: "1" } } }),
      }),
    )
    await executeGraphQL({
      endpoint: "https://api.example.com/graphql",
      query: "query GetUser($id: ID!) { user(id: $id) { id } }",
      variables: { id: "1" },
      operationName: "GetUser",
    })
    expect(fetchMock).toHaveBeenCalledWith("/api/proxy", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        url: "https://api.example.com/graphql",
        method: "POST",
        headers: {},
        body: JSON.stringify({
          query: "query GetUser($id: ID!) { user(id: $id) { id } }",
          variables: { id: "1" },
          operationName: "GetUser",
        }),
      }),
    }))
  })

  it("includes proxy auth headers", async () => {
    process.env.NEXT_PUBLIC_PROXY_SERVICE_TOKEN = "a".repeat(48)
    const fetchMock = vi.mocked(fetch).mockResolvedValueOnce(
      makeProxyResponse({ status: 200, body: "{}" }),
    )
    await executeGraphQL({ endpoint: "https://x", query: "{ hello }" })
    const headers = (fetchMock.mock.calls[0][1]?.headers ?? {}) as Record<string, string>
    expect(headers["Content-Type"]).toBe("application/json")
    expect(headers.Authorization).toBe("Bearer " + "a".repeat(48))
    delete process.env.NEXT_PUBLIC_PROXY_SERVICE_TOKEN
  })

  it("returns data on success", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeProxyResponse({ status: 200, body: JSON.stringify({ data: { hello: "world" } }) }),
    )
    const result = await executeGraphQL({ endpoint: "https://x", query: "{ hello }" })
    expect(result.data).toEqual({ hello: "world" })
    expect(result.errors).toBeUndefined()
  })

  it("returns errors array on GraphQL errors", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeProxyResponse({
        status: 200,
        body: JSON.stringify({ data: null, errors: [{ message: "Not found" }] }),
      }),
    )
    const result = await executeGraphQL({ endpoint: "https://x", query: "{ bad }" })
    expect(result.errors).toEqual([{ message: "Not found" }])
  })

  it("handles HTTP errors (proxy returns non-2xx)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: "Bad Gateway", status: 502, headers: {} }),
        { status: 502 },
      ),
    )
    const result = await executeGraphQL({ endpoint: "https://x", query: "{ x }" })
    expect(result.statusCode).toBe(502)
  })

  it("merges custom headers with defaults", async () => {
    const fetchMock = vi.mocked(fetch).mockResolvedValueOnce(
      makeProxyResponse({ status: 200, body: "{}" }),
    )
    await executeGraphQL({
      endpoint: "https://x",
      query: "{ x }",
      headers: { Authorization: "Bearer abc" },
    })
    const body = JSON.parse((fetchMock.mock.calls[0][1]?.body as string) ?? "{}")
    expect(body.headers.Authorization).toBe("Bearer abc")
  })
})

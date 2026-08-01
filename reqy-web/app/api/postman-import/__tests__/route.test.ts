/**
 * Integration tests for the Postman import routes.
 *
 * These hit the actual route handlers (not just the helper module) by
 * mocking `global.fetch` to simulate Postman's API responses. They prove
 * that:
 *   • auth (cookie) is enforced
 *   • the request body is validated
 *   • the extraction module is wired correctly
 *   • the response shape matches the contract the modals consume
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"

import { POST as savePost } from "@/app/api/postman-import/save/route"
import { POST as legacyPost } from "@/app/api/postman-import/route"

const POSTMAN_KEY = "PMAK-test-key"

function makeRequest(body: unknown, withCookie = true): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (withCookie) headers.cookie = `postman_api_key=${POSTMAN_KEY}`
  return new NextRequest("http://localhost/api/postman-import/save", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })
}

function mockPostmanCollection(collection: unknown) {
  global.fetch = vi.fn().mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ collection }),
  } as Response)
}

const FULL_COLLECTION = {
  info: { name: "Demo API", description: "Sample collection" },
  item: [
    {
      name: "Auth",
      item: [
        {
          name: "Login",
          request: {
            method: "POST",
            url: { raw: "https://api.example.com/login" },
            header: [{ key: "Content-Type", value: "application/json" }],
            body: { mode: "raw", raw: '{"user":"x"}' },
            auth: { type: "bearer", bearer: [{ key: "token", value: "abc" }] },
          },
        },
      ],
    },
    {
      name: "Health",
      request: {
        method: "GET",
        url: { raw: "https://api.example.com/health" },
      },
    },
  ],
}

describe("POST /api/postman-import/save", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("returns 401 when the postman_api_key cookie is missing", async () => {
    const res = await savePost(makeRequest({ collectionId: "c1" }, false))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.message).toMatch(/non connecté/i)
  })

  it("returns 400 when the body is invalid JSON", async () => {
    const req = new NextRequest(
      "http://localhost/api/postman-import/save",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `postman_api_key=${POSTMAN_KEY}`,
        },
        body: "not-json",
      },
    )
    const res = await savePost(req)
    expect(res.status).toBe(400)
  })

  it("returns 400 when collectionId is missing", async () => {
    const res = await savePost(makeRequest({}))
    expect(res.status).toBe(400)
  })

  it("returns ALL requests and folders from the Postman collection (regression for the .slice(0,3) bug)", async () => {
    // Build a collection with 10 requests to prove the full set is returned.
    const items = Array.from({ length: 10 }, (_, i) => ({
      name: `R${i + 1}`,
      request: {
        method: "GET",
        url: { raw: `https://api.example.com/r${i + 1}` },
      },
    }))
    mockPostmanCollection({ info: { name: "Big" }, item: items })

    const res = await savePost(makeRequest({ collectionId: "c1" }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.requests).toHaveLength(10)
    expect(body.folders).toHaveLength(0)
    expect(body.name).toBe("Big")
    expect(body.requests.map((r: { name: string }) => r.name)).toEqual(
      Array.from({ length: 10 }, (_, i) => `R${i + 1}`),
    )
  })

  it("extracts folders + auth + body and returns them coherently", async () => {
    mockPostmanCollection(FULL_COLLECTION)

    const res = await savePost(makeRequest({ collectionId: "c1" }))
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.folders).toHaveLength(1)
    expect(body.folders[0]).toMatchObject({ name: "Auth", parentId: null })

    expect(body.requests).toHaveLength(2)
    const [login, health] = body.requests
    expect(login).toMatchObject({
      name: "Login",
      method: "POST",
      folderId: body.folders[0].id,
      bodyType: "json",
      authType: "bearer",
      authToken: "abc",
    })
    expect(login.body).toBe('{"user":"x"}')
    expect(health).toMatchObject({
      name: "Health",
      method: "GET",
      folderId: null,
      authType: "none",
    })
    // bodyType is omitted when there is no body (matches the store schema)
    expect(health.bodyType).toBeUndefined()
    expect(health.authToken).toBeUndefined()
  })

  it("returns 401 when Postman rejects the API key", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () =>
        Promise.resolve({ error: { message: "Invalid API Key" } }),
    } as Response)
    const res = await savePost(makeRequest({ collectionId: "c1" }))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.message).toMatch(/Invalid API Key/)
  })
})

describe("POST /api/postman-import (legacy)", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("returns the legacy flat `routes` shape AND the rich folders/requests", async () => {
    mockPostmanCollection(FULL_COLLECTION)
    const res = await legacyPost(makeRequest({ collectionId: "c1" }))
    expect(res.status).toBe(200)
    const body = await res.json()

    // Legacy contract
    expect(body.name).toBe("Demo API")
    expect(body.framework).toBe("postman")
    expect(body.language).toBe("postman")
    expect(body.metadata).toEqual({
      collectionId: "c1",
      description: "Sample collection",
    })
    expect(body.routes).toHaveLength(2)
    expect(body.routes[0]).toMatchObject({
      method: "POST",
      name: "Login",
      // Domain is stripped — that's the legacy behaviour
      path: "/login",
    })
    expect(body.routes[1]).toMatchObject({
      method: "GET",
      path: "/health",
    })

    // Modern contract (passthrough, validated by Zod with passthrough on extras)
    expect(body.folders).toHaveLength(1)
    expect(body.requests).toHaveLength(2)
    expect(body.requests[0].authType).toBe("bearer")
  })

  it("returns 400 when collectionId is missing", async () => {
    const res = await legacyPost(makeRequest({}))
    expect(res.status).toBe(400)
  })

  it("returns 401 without the postman_api_key cookie", async () => {
    const res = await legacyPost(makeRequest({ collectionId: "c1" }, false))
    expect(res.status).toBe(401)
  })
})

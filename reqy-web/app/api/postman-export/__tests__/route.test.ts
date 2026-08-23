/**
 * Integration tests for POST /api/postman-export.
 *
 * Proves the route performs a REAL create-collection call against the
 * Postman API (cookie key → X-API-Key header + {"collection": …} v2.1 body),
 * and maps Postman errors (401/403/429/network) to clear responses instead of
 * the previous fictitious {exported:true}. A missing cookie yields 409
 * postman_not_connected — never a fake success.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

import { POST as exportPost } from "@/app/api/postman-export/route";

const POSTMAN_KEY = "PMAK-test-key";

function makeRequest(body: unknown, withCookie = true): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (withCookie) headers.cookie = `postman_api_key=${POSTMAN_KEY}`;
  return new NextRequest("http://localhost/api/postman-export", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const EXPORT_BODY = {
  name: "Export Reqly - Demo",
  description: "Sample export",
  requests: [
    {
      name: "Login",
      method: "POST",
      url: "https://api.example.com/login",
      headers: { "Content-Type": "application/json" },
      body: '{"user":"x"}',
    },
    {
      name: "Health",
      method: "GET",
      url: "https://api.example.com/health",
      headers: {},
      body: "",
    },
  ],
};

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/postman-export", () => {
  it("returns 409 postman_not_connected without the postman_api_key cookie", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock;
    const res = await exportPost(makeRequest(EXPORT_BODY, false));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("postman_not_connected");
    expect(body.message).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates the collection through the Postman API and returns its uid", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ collection: { uid: "12345678-abcdef" } }),
    } as Response);
    global.fetch = fetchMock;

    const res = await exportPost(makeRequest(EXPORT_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.exported).toBe(true);
    expect(body.postmanUid).toBe("12345678-abcdef");
    expect(String(body.url)).toContain("12345678-abcdef");
    expect(body.totalRequests).toBe(2);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.postman.com/collections");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-API-Key"]).toBe(POSTMAN_KEY);
    expect(headers["Content-Type"]).toBe("application/json");
    const sent = JSON.parse(String(init.body)) as {
      collection: { info: { name: string; schema: string }; item: unknown[] };
    };
    expect(sent.collection.info.name).toBe("Export Reqly - Demo");
    expect(sent.collection.info.schema).toContain("/collection/v2.1.0/");
    expect(sent.collection.item).toHaveLength(2);
  });

  it("maps a Postman 401 to an invalid-key message", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: { message: "Invalid API Key" } }),
    } as Response);
    const res = await exportPost(makeRequest(EXPORT_BODY));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("postman_invalid_key");
    expect(body.message).toMatch(/invalide ou expirée/i);
  });

  it("maps a Postman 403 to the same invalid-key path", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ error: { message: "Forbidden" } }),
    } as Response);
    const res = await exportPost(makeRequest(EXPORT_BODY));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("postman_invalid_key");
  });

  it("propagates a Postman 429 rate limit", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: () => Promise.resolve({ error: { message: "Rate limit" } }),
    } as Response);
    const res = await exportPost(makeRequest(EXPORT_BODY));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("postman_rate_limited");
  });

  it("maps network failures to a 502 without exported:true", async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const res = await exportPost(makeRequest(EXPORT_BODY));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.exported).toBeUndefined();
    expect(body.message).toBeTruthy();
  });

  it("maps timeout aborts to a 504", async () => {
    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";
    global.fetch = vi.fn().mockRejectedValue(abortError);
    const res = await exportPost(makeRequest(EXPORT_BODY));
    expect(res.status).toBe(504);
    const body = await res.json();
    expect(body.exported).toBeUndefined();
  });

  it("returns 400 for invalid input before contacting Postman", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock;
    const noRequests = await exportPost(makeRequest({ name: "x" }));
    expect(noRequests.status).toBe(400);
    const parseError = await exportPost(
      new NextRequest("http://localhost/api/postman-export", {
        method: "POST",
        headers: { cookie: `postman_api_key=${POSTMAN_KEY}` },
        body: "not json{",
      }),
    );
    expect(parseError.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

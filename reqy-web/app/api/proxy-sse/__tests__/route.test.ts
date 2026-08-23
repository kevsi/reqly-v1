// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  resolveCached: vi.fn(async (hostname: string) =>
    hostname === "public.example.com" ? "93.184.216.34" : null,
  ),
  createPinnedDispatcher: vi.fn(async () => undefined),
  checkRateLimit: vi.fn(() => ({ allowed: true, remaining: 30, resetAt: Date.now() + 60_000 })),
  getRateLimitKey: vi.fn(() => "test:key"),
}));

vi.mock("@/lib/security/dns-cache", () => ({
  resolveCached: mocks.resolveCached,
}));

vi.mock("@/lib/security/pinned-dispatcher", () => ({
  createPinnedDispatcher: mocks.createPinnedDispatcher,
}));

vi.mock("@/app/api/proxy-ai/lib/rate-limit", () => ({
  rateLimiter: { check: mocks.checkRateLimit },
  getRateLimitKey: mocks.getRateLimitKey,
}));

import { GET, POST, OPTIONS } from "../route";

function makeRequest(targetUrl: string, headers?: Record<string, string>) {
  const h = new Headers(headers ?? {});
  return {
    url: `http://localhost:3000/api/proxy-sse?url=${encodeURIComponent(targetUrl)}`,
    headers: h,
    signal: new AbortController().signal,
    text: () => Promise.resolve("{}"),
  } as unknown as NextRequest;
}

function mockUpstream(status: number, body: string | null, headers?: Record<string, string>) {
  return new Response(body, { status, headers });
}

describe("GET /api/proxy-sse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns 400 when the url parameter is missing", async () => {
    const req = {
      url: "http://localhost:3000/api/proxy-sse",
      headers: new Headers(),
    } as unknown as NextRequest;
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("MISSING_URL");
  });

  it("returns 400 for an invalid URL", async () => {
    const res = await GET(makeRequest("not a url"));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("INVALID_URL");
  });

  it("returns 400 for a non-http protocol", async () => {
    const res = await GET(makeRequest("ftp://example.com/file"));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("INVALID_PROTOCOL");
  });

  it("blocks private IP targets (SSRF)", async () => {
    const res = await GET(makeRequest("http://192.168.1.10/sse"));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("SSRF_BLOCKED");
  });

  it("returns 400 when DNS resolution fails", async () => {
    const res = await GET(makeRequest("http://unknown.internal/sse"));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("DNS_ERROR");
  });

  it("returns 429 when rate limited, with Retry-After", async () => {
    mocks.checkRateLimit.mockReturnValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 30_000,
    });
    const res = await GET(makeRequest("http://public.example.com/sse"));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
    expect((await res.json()).code).toBe("RATE_LIMITED");
  });

  it("streams the upstream SSE body and forwards content-type", async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockUpstream(200, "data: hello\n\n", { "Content-Type": "text/event-stream" }),
    );

    const res = await GET(
      makeRequest("http://public.example.com/sse", { Origin: "http://localhost:3000" }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("cache-control")).toBe("no-cache, no-transform");
    await expect(res.text()).resolves.toBe("data: hello\n\n");
  });

  it("only sends CORS headers to allowed origins", async () => {
    vi.mocked(fetch).mockResolvedValue(mockUpstream(200, "data: x\n\n"));

    const evil = await GET(
      makeRequest("http://public.example.com/sse", { Origin: "https://evil.example" }),
    );
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();

    const allowed = await GET(
      makeRequest("http://public.example.com/sse", { Origin: "http://localhost:3000" }),
    );
    expect(allowed.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
  });

  it("returns 502 when the upstream connection fails", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await GET(makeRequest("http://public.example.com/sse"));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe("BAD_GATEWAY");
    expect(body.detail).toBeUndefined();
  });

  it("blocks redirects to private IPs", async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockUpstream(302, null, { Location: "http://192.168.1.10/evil" }),
    );
    const res = await GET(makeRequest("http://public.example.com/start"));
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("BLOCKED_REDIRECT");
  });
});

describe("POST /api/proxy-sse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects oversized declared bodies with 413", async () => {
    const res = await POST(
      makeRequest("http://public.example.com/sse", { "Content-Length": String(10 * 1024 * 1024) }),
    );
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe("BODY_TOO_LARGE");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("OPTIONS /api/proxy-sse", () => {
  it("allows preflights from listed origins", async () => {
    const res = await OPTIONS(
      makeRequest("http://public.example.com/sse", {
        Origin: "http://localhost:3000",
        "Access-Control-Request-Headers": "Authorization, Content-Type",
      }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    expect(res.headers.get("access-control-allow-headers")).toBe("Authorization, Content-Type");
  });

  it("denies preflights from unlisted origins", async () => {
    const res = await OPTIONS(
      makeRequest("http://public.example.com/sse", { Origin: "https://evil.example" }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

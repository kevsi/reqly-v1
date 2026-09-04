// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  resolveCached: vi.fn(async (hostname: string) =>
    hostname === "private.example" ? "10.0.0.5" : "93.184.216.34",
  ),
  captureRequest: vi.fn(async () => ({})),
  captureResponse: vi.fn(async () => ({})),
  recordCapturedRequest: vi.fn(async () => {}),
  requireCaptureUserId: vi.fn(async () => "test-user"),
  isPublicWebDeployment: vi.fn(() => false),
  CaptureAuthError: class CaptureAuthError extends Error {
    constructor(
      message: string,
      public readonly status: number,
    ) {
      super(message);
      this.name = "CaptureAuthError";
    }
  },
}));

vi.mock("@/lib/security/dns-cache", () => ({
  resolveCached: mocks.resolveCached,
}));

vi.mock("@/lib/capture-middleware", () => ({
  captureRequest: mocks.captureRequest,
  captureResponse: mocks.captureResponse,
  recordCapturedRequest: mocks.recordCapturedRequest,
}));

vi.mock("@/lib/capture-auth", () => ({
  requireCaptureUserId: mocks.requireCaptureUserId,
  CaptureAuthError: mocks.CaptureAuthError,
}));

vi.mock("@/lib/environment", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/environment")>()),
  isPublicWebDeployment: mocks.isPublicWebDeployment,
}));

// The route opens a TCP connect probe in parallel with the upstream fetch;
// short-circuit it so tests never touch the real network.
vi.mock("node:net", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:net")>();
  return {
    ...actual,
    default: {
      ...actual,
      connect: () => ({
        once: (event: string, cb: () => void) => {
          if (event === "error") queueMicrotask(cb);
        },
        destroy: () => {},
      }),
    },
  };
});

import { POST } from "../route";

function makeRequest(payload: unknown) {
  // Fix (audit 2026-09-03) : la route lit request.body (cap stream) AVANT le
  // fallback json() — le mock n'exposait pas de body, tous les tests
  // renvoyaient INVALID_JSON. On fournit un ReadableStream du payload.
  const serialized = JSON.stringify(payload);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(serialized));
      controller.close();
    },
  });
  return {
    json: async () => payload,
    headers: new Headers(),
    body,
  } as unknown as NextRequest;
}

function redirectResponse(status: number, location: string): Response {
  return new Response(null, { status, headers: { location } });
}

describe("POST /api/proxy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("proxies a basic request and returns the upstream body", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response("hello", { status: 200, headers: { "content-type": "text/plain" } }),
    );

    const res = await POST(
      makeRequest({ url: "https://public.example.com/x", method: "GET", headers: {} }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe(200);
    expect(data.body).toBe("hello");
  });

  it("surfaces a 3xx to the caller when followRedirects is off (no silent following)", async () => {
    vi.mocked(fetch).mockResolvedValue(redirectResponse(302, "https://public.example.com/next"));

    const res = await POST(
      makeRequest({ url: "https://public.example.com/start", method: "GET", headers: {} }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe(302);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("blocks a 3xx pointing to a private IP even when not following", async () => {
    vi.mocked(fetch).mockResolvedValue(redirectResponse(302, "http://192.168.1.10/evil"));

    const res = await POST(
      makeRequest({ url: "https://public.example.com/start", method: "GET", headers: {} }),
    );
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error).toBe("blocked_redirect");
  });

  it("follows redirects when followRedirects is set, converting POST to GET on 302", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(redirectResponse(302, "https://public.example.com/next"))
      .mockResolvedValueOnce(
        new Response("final", { status: 200, headers: { "content-type": "text/plain" } }),
      );

    const res = await POST(
      makeRequest({
        url: "https://public.example.com/start",
        method: "POST",
        headers: {},
        body: "data",
        followRedirects: true,
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.body).toBe("final");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondCall = fetchMock.mock.calls[1];
    expect(secondCall[0]).toBe("https://public.example.com/next");
    expect(secondCall[1]).toMatchObject({ method: "GET", body: undefined });
  });

  it("refuses to follow a redirect to a private IP", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(redirectResponse(302, "http://192.168.1.10/evil"));

    const res = await POST(
      makeRequest({
        url: "https://public.example.com/start",
        method: "GET",
        headers: {},
        followRedirects: true,
      }),
    );
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("blocked_redirect");
  });

  it("refuses to follow a redirect resolving to a private IP (DNS rebinding)", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(redirectResponse(302, "http://private.example/evil"));

    const res = await POST(
      makeRequest({
        url: "https://public.example.com/start",
        method: "GET",
        headers: {},
        followRedirects: true,
      }),
    );
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("blocked_redirect");
  });

  it("gives up after MAX_REDIRECTS hops with too_many_redirects", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (url: string) => redirectResponse(302, `${url}?hop=1`));

    const res = await POST(
      makeRequest({
        url: "https://public.example.com/loop",
        method: "GET",
        headers: {},
        followRedirects: true,
      }),
    );
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("too_many_redirects");
    // 1 initial + 5 followed hops
    expect(fetchMock.mock.calls.length).toBe(6);
  });

  it("rejects invalid payloads with 400", async () => {
    const res = await POST(makeRequest({ method: "GET" }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("INVALID_PAYLOAD");
  });

  it("classifies an ECONNREFUSED upstream failure as TARGET_UNREACHABLE (not generic BAD_GATEWAY)", async () => {
    const cause = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:443"), {
      code: "ECONNREFUSED",
    });
    vi.mocked(fetch).mockRejectedValue(Object.assign(new TypeError("fetch failed"), { cause }));

    const res = await POST(
      makeRequest({ url: "https://public.example.com/x", method: "GET", headers: {} }),
    );
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.code).toBe("TARGET_UNREACHABLE");
    expect(data.error).toContain("ECONNREFUSED");
  });

  it("classifies ENOTFOUND and undici connect timeouts as TARGET_UNREACHABLE", async () => {
    for (const code of ["ENOTFOUND", "UND_ERR_CONNECT_TIMEOUT"]) {
      vi.mocked(fetch).mockRejectedValue(
        Object.assign(new TypeError("fetch failed"), {
          cause: Object.assign(new Error(code), { code }),
        }),
      );
      const res = await POST(
        makeRequest({ url: "https://public.example.com/x", method: "GET", headers: {} }),
      );
      expect((await res.json()).code).toBe("TARGET_UNREACHABLE");
    }
  });

  it("classifies TLS certificate failures as CERTIFICATE_ERROR", async () => {
    const cause = Object.assign(new Error("self signed certificate"), {
      code: "DEPTH_ZERO_SELF_SIGNED_CERT",
    });
    vi.mocked(fetch).mockRejectedValue(Object.assign(new TypeError("fetch failed"), { cause }));

    const res = await POST(
      makeRequest({ url: "https://public.example.com/x", method: "GET", headers: {} }),
    );
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.code).toBe("CERTIFICATE_ERROR");
    expect(data.error).toContain("certificate");
  });

  it("keeps TIMEOUT for an aborted upstream fetch", async () => {
    vi.mocked(fetch).mockRejectedValue(
      new DOMException("The operation was aborted.", "AbortError"),
    );

    const res = await POST(
      makeRequest({ url: "https://public.example.com/x", method: "GET", headers: {} }),
    );
    expect(res.status).toBe(504);
    expect((await res.json()).code).toBe("TIMEOUT");
  });
});

describe("POST /api/proxy auth gate (open proxy guard)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
    mocks.isPublicWebDeployment.mockReturnValue(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the auth error status without fetching when unauthenticated on a public deployment", async () => {
    mocks.isPublicWebDeployment.mockReturnValue(true);
    mocks.requireCaptureUserId.mockRejectedValueOnce(
      new mocks.CaptureAuthError("Authentication required", 401),
    );

    const res = await POST(
      makeRequest({ url: "https://public.example.com/x", method: "GET", headers: {} }),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Authentication required" });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("propagates the auth service status (503) on public deployments", async () => {
    mocks.isPublicWebDeployment.mockReturnValue(true);
    mocks.requireCaptureUserId.mockRejectedValueOnce(
      new mocks.CaptureAuthError("Authentication service unavailable", 503),
    );

    const res = await POST(
      makeRequest({ url: "https://public.example.com/x", method: "GET", headers: {} }),
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Authentication required" });
  });

  it("authenticates once and passes through to the fetch logic when authenticated", async () => {
    mocks.isPublicWebDeployment.mockReturnValue(true);
    mocks.requireCaptureUserId.mockResolvedValueOnce("user-1");
    vi.mocked(fetch).mockResolvedValue(
      new Response("hello", { status: 200, headers: { "content-type": "text/plain" } }),
    );

    const res = await POST(
      makeRequest({ url: "https://public.example.com/x", method: "GET", headers: {} }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).body).toBe("hello");
    // Single validation pass: the resolved id is reused for capture
    // attribution instead of being re-checked.
    expect(mocks.requireCaptureUserId).toHaveBeenCalledTimes(1);
  });

  it("keeps the legacy desktop/self-hosted behavior when the public flag is false", async () => {
    mocks.isPublicWebDeployment.mockReturnValue(false);
    vi.mocked(fetch).mockResolvedValue(
      new Response("hello", { status: 200, headers: { "content-type": "text/plain" } }),
    );

    const res = await POST(
      makeRequest({ url: "https://public.example.com/x", method: "GET", headers: {} }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).body).toBe("hello");
    // No upfront gate — capture attribution resolves the user as before.
    expect(mocks.requireCaptureUserId).toHaveBeenCalledTimes(1);
  });
});

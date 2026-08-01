import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * Tests for the Bearer SERVICE_TOKEN gate in `reqy-web/proxy.ts`.
 *
 * Threat model recap: reqly-web runs as a sidecar bound to 127.0.0.1
 * (see the Phase 1 step-3 plan). The proxy protects against a
 * third-party process on the same machine trying to call the sidecar's
 * sensitive API routes. It is NOT a public-Internet auth gate.
 */

const VALID_TOKEN = "a".repeat(48); // 48 bytes, well above the 32-byte minimum

interface MockRequestInit {
  pathname: string;
  authorization?: string;
}

/**
 * Build a minimal NextRequest stub that satisfies the surface the
 * proxy actually touches: `nextUrl.pathname` and `headers.get()`.
 * We deliberately do NOT use the real NextRequest because the proxy
 * function is the unit under test — pulling in Next.js server runtime
 * for a proxy test would couple the test to framework internals.
 */
function makeMockRequest({ pathname, authorization }: MockRequestInit): NextRequest {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return {
    nextUrl: { pathname } as NextRequest["nextUrl"],
    headers,
  } as unknown as NextRequest;
}

beforeEach(() => {
  delete process.env.PROXY_SERVICE_TOKEN;
});

afterEach(() => {
  delete process.env.PROXY_SERVICE_TOKEN;
  vi.restoreAllMocks();
});

describe("proxy: UI routes pass through without token", () => {
  beforeEach(() => {
    // Configure a valid token so we know a 401/503 in these tests comes
    // from the path-bypass logic, not from a missing env.
    process.env.PROXY_SERVICE_TOKEN = VALID_TOKEN;
  });

  it("passes through /", async () => {
    const { proxy } = await import("../../proxy");
    const res = proxy(makeMockRequest({ pathname: "/" }));
    expect(res.status).toBe(200);
  });

  it("passes through /_next/static/foo.png", async () => {
    const { proxy } = await import("../../proxy");
    const res = proxy(makeMockRequest({ pathname: "/_next/static/foo.png" }));
    expect(res.status).toBe(200);
  });

  it("passes through arbitrary /api routes NOT in the protected list (e.g. /api/auth/foo)", async () => {
    const { proxy } = await import("../../proxy");
    const res = proxy(makeMockRequest({ pathname: "/api/auth/foo" }));
    expect(res.status).toBe(200);
  });

  it("passes through /api (exact root) since /api alone is not in the protected prefixes", async () => {
    const { proxy } = await import("../../proxy");
    const res = proxy(makeMockRequest({ pathname: "/api" }));
    expect(res.status).toBe(200);
  });
});

describe("proxy: protected routes without valid token return 401", () => {
  beforeEach(() => {
    process.env.PROXY_SERVICE_TOKEN = VALID_TOKEN;
  });

  it("rejects /api/proxy with no Authorization header", async () => {
    const { proxy } = await import("../../proxy");
    const res = proxy(makeMockRequest({ pathname: "/api/proxy" }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({ error: "Unauthorized", code: "PROXY_AUTH_REQUIRED" });
  });

  it("rejects /api/proxy-ai with malformed Authorization header", async () => {
    const { proxy } = await import("../../proxy");
    const res = proxy(
      makeMockRequest({ pathname: "/api/proxy-ai", authorization: "Basic dXNlcjpwYXNz" }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects /api/proxy-models with empty Bearer", async () => {
    const { proxy } = await import("../../proxy");
    const res = proxy(makeMockRequest({ pathname: "/api/proxy-models", authorization: "Bearer " }));
    expect(res.status).toBe(401);
  });

  it("rejects /api/test-runner/run with wrong token", async () => {
    const { proxy } = await import("../../proxy");
    const res = proxy(
      makeMockRequest({
        pathname: "/api/test-runner/run",
        authorization: "Bearer " + "z".repeat(48),
      }),
    );
    expect(res.status).toBe(401);
  });

  // Phase 4: import/export routes must be gated too (postman-auth is exempt — it uses its own API key auth)
  // (they read stored Postman/GitHub tokens and trigger external API calls).
  it("rejects /api/postman-import with no Authorization header", async () => {
    const { proxy } = await import("../../proxy");
    const res = proxy(makeMockRequest({ pathname: "/api/postman-import" }));
    expect(res.status).toBe(401);
  });

  it("rejects /api/postman-import/save with wrong token", async () => {
    const { proxy } = await import("../../proxy");
    const res = proxy(
      makeMockRequest({
        pathname: "/api/postman-import/save",
        authorization: "Bearer " + "z".repeat(48),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects /api/postman-export with no Authorization header", async () => {
    const { proxy } = await import("../../proxy");
    const res = proxy(makeMockRequest({ pathname: "/api/postman-export" }));
    expect(res.status).toBe(401);
  });

  it("rejects /api/github-import with wrong token", async () => {
    const { proxy } = await import("../../proxy");
    const res = proxy(
      makeMockRequest({
        pathname: "/api/github-import",
        authorization: "Bearer " + "z".repeat(48),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("passes /api/postman-auth through (no proxy auth needed)", async () => {
    const { proxy } = await import("../../proxy");
    const res = proxy(makeMockRequest({ pathname: "/api/postman-auth" }));
    expect(res.status).toBe(200);
  });

  it("passes /api/postman-auth/collections through (no proxy auth needed)", async () => {
    const { proxy } = await import("../../proxy");
    const res = proxy(
      makeMockRequest({
        pathname: "/api/postman-auth/collections",
        authorization: "Bearer " + "z".repeat(48),
      }),
    );
    expect(res.status).toBe(200);
  });

  // Phase 2 step 7: /api/mock and /api/mock/config routes are deleted.
  // The corresponding proxy tests are removed. The matcher entry
  // in proxy.ts is kept as a defensive failsafe.
});

describe("proxy: protected routes with valid token return 200", () => {
  beforeEach(() => {
    process.env.PROXY_SERVICE_TOKEN = VALID_TOKEN;
  });

  it("allows /api/proxy with matching Bearer token", async () => {
    const { proxy } = await import("../../proxy");
    const res = proxy(
      makeMockRequest({ pathname: "/api/proxy", authorization: `Bearer ${VALID_TOKEN}` }),
    );
    expect(res.status).toBe(200);
    // Sanity check that we got the NextResponse.next() pass-through
    // sentinel, not a JSON error body. The JSON 401/503 responses set
    // `content-type: application/json`; NextResponse.next() has no body
    // and therefore no content-type header. A missing/invalid token
    // request would NOT reach this branch — see the "protected routes
    // without valid token" describe block above.
    expect(res.headers.get("content-type")).toBeNull();
  });

  it("is case-insensitive on the Bearer scheme", async () => {
    const { proxy } = await import("../../proxy");
    const res = proxy(
      makeMockRequest({ pathname: "/api/proxy", authorization: `bearer ${VALID_TOKEN}` }),
    );
    expect(res.status).toBe(200);
  });

  it("trims whitespace around the token", async () => {
    const { proxy } = await import("../../proxy");
    const res = proxy(
      makeMockRequest({
        pathname: "/api/proxy",
        authorization: `Bearer    ${VALID_TOKEN}   `,
      }),
    );
    expect(res.status).toBe(200);
  });

  // Phase 4: verify the newly protected import/export + postman-auth
  // routes also pass through with a valid token.
  it("allows /api/postman-import with matching Bearer token", async () => {
    const { proxy } = await import("../../proxy");
    const res = proxy(
      makeMockRequest({
        pathname: "/api/postman-import",
        authorization: `Bearer ${VALID_TOKEN}`,
      }),
    );
    expect(res.status).toBe(200);
  });

  it("allows /api/postman-import/save with matching Bearer token", async () => {
    const { proxy } = await import("../../proxy");
    const res = proxy(
      makeMockRequest({
        pathname: "/api/postman-import/save",
        authorization: `Bearer ${VALID_TOKEN}`,
      }),
    );
    expect(res.status).toBe(200);
  });

  it("allows /api/postman-export with matching Bearer token", async () => {
    const { proxy } = await import("../../proxy");
    const res = proxy(
      makeMockRequest({
        pathname: "/api/postman-export",
        authorization: `Bearer ${VALID_TOKEN}`,
      }),
    );
    expect(res.status).toBe(200);
  });

  it("allows /api/github-import with matching Bearer token", async () => {
    const { proxy } = await import("../../proxy");
    const res = proxy(
      makeMockRequest({
        pathname: "/api/github-import",
        authorization: `Bearer ${VALID_TOKEN}`,
      }),
    );
    expect(res.status).toBe(200);
  });

  it("allows /api/postman-auth with matching Bearer token", async () => {
    const { proxy } = await import("../../proxy");
    const res = proxy(
      makeMockRequest({
        pathname: "/api/postman-auth",
        authorization: `Bearer ${VALID_TOKEN}`,
      }),
    );
    expect(res.status).toBe(200);
  });

  it("allows /api/postman-auth/collections with matching Bearer token", async () => {
    const { proxy } = await import("../../proxy");
    const res = proxy(
      makeMockRequest({
        pathname: "/api/postman-auth/collections",
        authorization: `Bearer ${VALID_TOKEN}`,
      }),
    );
    expect(res.status).toBe(200);
  });
});

describe("proxy: public OAuth routes pass through without token", () => {
  // Phase 4: /api/github-auth/* are the OAuth redirect/callback pair.
  // The browser cannot attach a Bearer header to a navigation, so they
  // must remain reachable without the SERVICE_TOKEN. Security is
  // enforced by the `state` cookie + server-side client secret.
  beforeEach(() => {
    process.env.PROXY_SERVICE_TOKEN = VALID_TOKEN;
  });

  it("passes through /api/github-auth/start (OAuth initiation redirect)", async () => {
    const { proxy } = await import("../../proxy");
    const res = proxy(makeMockRequest({ pathname: "/api/github-auth/start" }));
    expect(res.status).toBe(200);
  });

  it("passes through /api/github-auth/callback (OAuth code exchange)", async () => {
    const { proxy } = await import("../../proxy");
    const res = proxy(
      makeMockRequest({ pathname: "/api/github-auth/callback?code=abc&state=xyz" }),
    );
    expect(res.status).toBe(200);
  });
});

describe("proxy: fail-closed when env not configured", () => {
  it("returns 503 when PROXY_SERVICE_TOKEN is unset", async () => {
    delete process.env.PROXY_SERVICE_TOKEN;
    const { proxy } = await import("../../proxy");
    const res = proxy(
      makeMockRequest({ pathname: "/api/proxy", authorization: `Bearer ${VALID_TOKEN}` }),
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ error: "Service token not configured" });
  });

  it("returns 503 when PROXY_SERVICE_TOKEN is too short (< 32 bytes)", async () => {
    process.env.PROXY_SERVICE_TOKEN = "short-token";
    const { proxy } = await import("../../proxy");
    const res = proxy(
      makeMockRequest({ pathname: "/api/proxy", authorization: `Bearer ${VALID_TOKEN}` }),
    );
    expect(res.status).toBe(503);
  });

  it("does not allow UI routes even when env is misconfigured (proxy returns 200 for UI passes-through; this test guards the env-check ordering)", async () => {
    delete process.env.PROXY_SERVICE_TOKEN;
    const { proxy } = await import("../../proxy");
    // UI paths short-circuit BEFORE the env check, so they must still
    // pass through. The 503 is reserved for *protected* paths.
    const res = proxy(makeMockRequest({ pathname: "/" }));
    expect(res.status).toBe(200);
  });
});

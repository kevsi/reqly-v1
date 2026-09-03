import { NextRequest } from "next/server";
import { isBlockedIp } from "@/lib/security/ssrf";
import { resolveCached } from "@/lib/security/dns-cache";
import { getServerEnv } from "@/lib/env";
import { isIP } from "node:net";
import { createPinnedDispatcher } from "@/lib/security/pinned-dispatcher";
import { rateLimiter, getRateLimitKey } from "../proxy-ai/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_SSE_BODY_BYTES = 2 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 5 * 60 * 1000;

/** Origins allowed to consume this proxy cross-origin (dev + ALLOWED_ORIGIN). */
function getAllowedOrigins(): string[] {
  const configured =
    process.env.ALLOWED_ORIGIN?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? [];
  return Array.from(new Set(["http://localhost:3000", "http://127.0.0.1:3000", ...configured]));
}

/**
 * Build CORS headers only for allowed origins. Third-party sites (which could
 * otherwise turn this route into an open proxy) get no CORS headers and are
 * blocked by the browser. Same-origin callers need no CORS headers at all.
 */
function corsHeaders(request: NextRequest): Record<string, string> | null {
  const origin = request.headers.get("origin");
  if (!origin || !getAllowedOrigins().includes(origin)) return null;
  const requestedHeaders = request.headers.get("access-control-request-headers");
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": requestedHeaders || "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

/**
 * SSE Streaming Proxy
 *
 * Route: /api/proxy-sse
 *
 * Contrairement à /api/proxy (qui bufferise la réponse complète),
 * cette route pipe le ReadableStream SSE de l'upstream directement
 * vers le client, sans bufferisation. Cela permet de contourner les
 * restrictions CORS du navigateur tout en conservant le streaming temps réel.
 *
 * Supporte GET (EventSource standard) et POST/PUT (LLM APIs, etc.)
 *
 * Paramètre requis: ?url=<url-encodée>
 * Headers forwarded: tous les headers de la requête entrante sauf Host/origin
 */
export async function GET(request: NextRequest) {
  return handleSSEProxy(request, "GET");
}

export async function POST(request: NextRequest) {
  return handleSSEProxy(request, "POST");
}

export async function PUT(request: NextRequest) {
  return handleSSEProxy(request, "PUT");
}

// CORS pre-flight for SSE proxy
export async function OPTIONS(request: NextRequest) {
  const cors = corsHeaders(request);
  if (!cors) {
    // Deny cross-origin preflights from unlisted origins.
    return new Response(null, { status: 204 });
  }
  return new Response(null, {
    status: 204,
    headers: cors,
  });
}

async function handleSSEProxy(request: NextRequest, method: string): Promise<Response> {
  // ── Rate limiting (defence-in-depth against open-proxy abuse) ──────────
  const rateKey = getRateLimitKey(request);
  const { allowed, resetAt } = await rateLimiter.check(`proxy-sse:${rateKey}`);
  if (!allowed) {
    return new Response(
      JSON.stringify({
        error: "Trop de requêtes, réessayez plus tard",
        code: "RATE_LIMITED",
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))),
        },
      },
    );
  }

  const { searchParams } = new URL(request.url);
  const rawUrl = searchParams.get("url");

  // ── Validate target URL ──────────────────────────────────────────────────
  if (!rawUrl) {
    return new Response(
      JSON.stringify({ error: "Missing required query parameter: url", code: "MISSING_URL" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid URL format", code: "INVALID_URL" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    return new Response(
      JSON.stringify({
        error: "Only HTTP and HTTPS protocols are allowed",
        code: "INVALID_PROTOCOL",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // ── SSRF protection ─────────────────────────────────────────────────────
  const env = getServerEnv();
  const allowLocal = process.env.NODE_ENV === "development" || env.ALLOW_LOCAL_HOSTS === "true";

  const targetUrl = parsedUrl.href;

  if (!allowLocal) {
    if (isIP(parsedUrl.hostname) && isBlockedIp(parsedUrl.hostname)) {
      return new Response(
        JSON.stringify({
          error: "Requests to private/internal hosts are not allowed",
          code: "SSRF_BLOCKED",
        }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }

    const resolvedIp = await resolveCached(parsedUrl.hostname);
    if (!resolvedIp) {
      return new Response(JSON.stringify({ error: "DNS resolution failed", code: "DNS_ERROR" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (isBlockedIp(resolvedIp)) {
      return new Response(
        JSON.stringify({
          error: "Requests to private/internal hosts are not allowed (DNS rebinding prevention)",
          code: "SSRF_BLOCKED",
        }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }

    // Keep the hostname for TLS/SNI; the dispatcher pins the socket address.
  }

  // ── Forward headers (strip hop-by-hop, CORS collision and credential headers)
  const BLOCKED_HEADERS = new Set([
    "host",
    "connection",
    "upgrade",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "origin",
    "referer",
    // SECURITY: never forward our own origin's cookies to an arbitrary
    // upstream — the browser attaches them automatically, and they would leak
    // the reqly session (auth_session, github_token, …) to any target host.
    // Authorization / x-api-key are still forwarded: the client sets them
    // deliberately per-request for the target API.
    "cookie",
  ]);
  const BLOCKED_HEADER_PREFIXES = [
    "x-forwarded",
    "x-real-ip",
    // Infrastructure/vendor headers that may carry internal routing info.
    "cf-",
    "x-vercel-",
    "x-amz",
    "x-cloudfront-",
  ];

  const forwardedHeaders: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (
      !BLOCKED_HEADERS.has(lower) &&
      !BLOCKED_HEADER_PREFIXES.some((p) => lower.startsWith(p))
    ) {
      forwardedHeaders[lower] = value;
    }
  });

  // Restore original Host for SNI/virtualhost matching
  forwardedHeaders["host"] = parsedUrl.host;

  // ── Read body for POST/PUT ───────────────────────────────────────────────
  let body: string | undefined;
  if (method === "POST" || method === "PUT") {
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_SSE_BODY_BYTES) {
      return new Response(
        JSON.stringify({ error: "Request body too large", code: "BODY_TOO_LARGE" }),
        {
          status: 413,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    try {
      body = await request.text();
      if (new TextEncoder().encode(body).byteLength > MAX_SSE_BODY_BYTES) {
        return new Response(
          JSON.stringify({ error: "Request body too large", code: "BODY_TOO_LARGE" }),
          {
            status: 413,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
    } catch {
      body = undefined;
    }
  }

  // ── Abort controller with client disconnect detection ────────────────────
  const abortController = new AbortController();
  request.signal.addEventListener("abort", () => abortController.abort());
  const timeout = setTimeout(() => abortController.abort(), UPSTREAM_TIMEOUT_MS);
  let dispatcher: Awaited<ReturnType<typeof createPinnedDispatcher>>;
  try {
    dispatcher = await createPinnedDispatcher(targetUrl);
  } catch {
    clearTimeout(timeout);
    return new Response(
      JSON.stringify({
        error: "Requests to private/internal hosts are not allowed",
        code: "SSRF_BLOCKED",
      }),
      {
        status: 403,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // ── Fetch upstream ───────────────────────────────────────────────────────
  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(targetUrl, {
      method,
      headers: forwardedHeaders,
      body: body ?? undefined,
      signal: abortController.signal,
      redirect: "manual",
      ...(dispatcher ? { dispatcher } : {}),
    });
  } catch {
    clearTimeout(timeout);
    await dispatcher?.close().catch(() => undefined);
    return new Response(
      JSON.stringify({ error: "Upstream connection failed", code: "BAD_GATEWAY" }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }
  clearTimeout(timeout);

  // ── SSRF hardening for redirects ────────────────────────────────────────
  // With redirect: "manual" the upstream 3xx is surfaced to the client
  // instead of being followed server-side, but we still validate the Location
  // header so a public endpoint that redirects to a private host is rejected
  // outright (defense-in-depth, mirroring /api/proxy).
  const location = upstreamResponse.headers.get("location");
  if (location && upstreamResponse.status >= 300 && upstreamResponse.status < 400) {
    let locationUrl: URL;
    try {
      locationUrl = new URL(location, parsedUrl);
    } catch {
      await dispatcher?.close().catch(() => undefined);
      return new Response(
        JSON.stringify({
          error: "Redirect to invalid destination",
          code: "BLOCKED_REDIRECT",
        }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }
    if (!["http:", "https:"].includes(locationUrl.protocol)) {
      await dispatcher?.close().catch(() => undefined);
      return new Response(
        JSON.stringify({
          error: "Redirect to blocked destination: invalid protocol",
          code: "BLOCKED_REDIRECT",
        }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }
    if (!allowLocal) {
      if (isIP(locationUrl.hostname) && isBlockedIp(locationUrl.hostname)) {
        await dispatcher?.close().catch(() => undefined);
        return new Response(
          JSON.stringify({
            error: "Redirect to blocked destination: private/internal IP",
            code: "BLOCKED_REDIRECT",
          }),
          { status: 502, headers: { "Content-Type": "application/json" } },
        );
      }
      const resolvedRedirect = await resolveCached(locationUrl.hostname);
      if (!resolvedRedirect || isBlockedIp(resolvedRedirect)) {
        await dispatcher?.close().catch(() => undefined);
        return new Response(
          JSON.stringify({
            error: "Redirect to blocked destination: private/internal IP",
            code: "BLOCKED_REDIRECT",
          }),
          { status: 502, headers: { "Content-Type": "application/json" } },
        );
      }
    }
  }

  if (!upstreamResponse.ok && !upstreamResponse.body) {
    return new Response(
      JSON.stringify({
        error: `Upstream error: ${upstreamResponse.status} ${upstreamResponse.statusText}`,
        code: "UPSTREAM_ERROR",
      }),
      { status: upstreamResponse.status, headers: { "Content-Type": "application/json" } },
    );
  }

  // ── Build response headers (proxy the upstream content-type / etc.) ──────
  const responseHeaders: Record<string, string> = {
    // SSE/streaming specific
    "Cache-Control": "no-cache, no-transform",
    // CORS: allow the browser to consume the stream cross-origin (only
    // for allowed origins, blocking third-party open-proxy usage).
    ...(corsHeaders(request) ?? {}),
  };

  // Forward relevant headers from upstream
  const FORWARDED_FROM_UPSTREAM = ["content-type", "retry-after", "x-request-id"];
  upstreamResponse.headers.forEach((value, key) => {
    if (FORWARDED_FROM_UPSTREAM.includes(key.toLowerCase())) {
      responseHeaders[key] = value;
    }
  });

  // Ensure Content-Type is SSE if upstream says so
  const upstreamContentType = upstreamResponse.headers.get("content-type") ?? "";
  if (!upstreamContentType) {
    responseHeaders["content-type"] = "text/event-stream; charset=utf-8";
  }

  // ── Pipe the upstream body directly to the client (no buffering) ─────────
  const upstreamBody = upstreamResponse.body;
  if (!upstreamBody) {
    return new Response("", { status: upstreamResponse.status, headers: responseHeaders });
  }

  return new Response(upstreamBody, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
}

import { NextRequest } from "next/server";
import { isPrivateHost, isBlockedIp } from "@/lib/security/ssrf";
import { resolveCached } from "@/lib/security/dns-cache";
import { getServerEnv } from "@/lib/env";
import { isIP } from "node:net";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Max-Age": "86400",
    },
  });
}

async function handleSSEProxy(request: NextRequest, method: string): Promise<Response> {
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

  let targetUrl = parsedUrl.href;

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

    // Pin to resolved IP to prevent DNS rebinding
    const portPart = parsedUrl.port ? `:${parsedUrl.port}` : "";
    const hostLiteral = isIP(resolvedIp) === 6 ? `[${resolvedIp}]` : resolvedIp;
    targetUrl = `${parsedUrl.protocol}//${hostLiteral}${portPart}${parsedUrl.pathname}${parsedUrl.search}`;
  }

  // ── Forward headers (strip hop-by-hop and CORS collision headers) ────────
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
  ]);

  const forwardedHeaders: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (
      !BLOCKED_HEADERS.has(lower) &&
      !lower.startsWith("x-forwarded") &&
      !lower.startsWith("x-real-ip")
    ) {
      forwardedHeaders[lower] = value;
    }
  });

  // Restore original Host for SNI/virtualhost matching
  forwardedHeaders["host"] = parsedUrl.host;

  // ── Read body for POST/PUT ───────────────────────────────────────────────
  let body: string | undefined;
  if (method === "POST" || method === "PUT") {
    try {
      body = await request.text();
    } catch {
      body = undefined;
    }
  }

  // ── Abort controller with client disconnect detection ────────────────────
  const abortController = new AbortController();
  request.signal.addEventListener("abort", () => abortController.abort());

  // ── Fetch upstream ───────────────────────────────────────────────────────
  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(targetUrl, {
      method,
      headers: forwardedHeaders,
      body: body ?? undefined,
      signal: abortController.signal,
      redirect: "manual",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: "Upstream connection failed", code: "BAD_GATEWAY", detail: message }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
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
  const responseHeaders: HeadersInit = {
    // SSE/streaming specific
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // CORS: allow the browser to consume the stream cross-origin
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
  };

  // Forward relevant headers from upstream
  const FORWARDED_FROM_UPSTREAM = ["content-type", "retry-after", "x-request-id"];
  upstreamResponse.headers.forEach((value, key) => {
    if (FORWARDED_FROM_UPSTREAM.includes(key.toLowerCase())) {
      (responseHeaders as Record<string, string>)[key] = value;
    }
  });

  // Ensure Content-Type is SSE if upstream says so
  const upstreamContentType = upstreamResponse.headers.get("content-type") ?? "";
  if (!upstreamContentType) {
    (responseHeaders as Record<string, string>)["content-type"] =
      "text/event-stream; charset=utf-8";
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

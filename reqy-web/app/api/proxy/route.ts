export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { validateProxyPayload } from "@/lib/schemas/proxy";

import {
  InMemoryRateLimiter,
  UpstashRateLimiter,
  type DistributedRateLimiter,
  type RateLimitResult,
} from "@/lib/rate-limiter";
import { getServerEnv } from "@/lib/env";
import { isPrivateHost, isBlockedIp } from "@/lib/security/ssrf";
import { readWithCap } from "@/lib/security/streaming";
import { resolveCached } from "@/lib/security/dns-cache";
import net, { isIP } from "node:net";

/**
 * Parse a single Set-Cookie header value into structured fields.
 * Only the attributes we surface in the UI are decoded (domain, path,
 * secure, httponly, samesite, expires).
 */
function parseSetCookie(raw: string): {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string;
  expires: string | null;
} {
  const [pair, ...attrs] = raw.split(";");
  const eq = pair.indexOf("=");
  const name = eq >= 0 ? pair.slice(0, eq).trim() : pair.trim();
  const value = eq >= 0 ? pair.slice(eq + 1).trim() : "";
  let domain = "";
  let path = "/";
  let secure = false;
  let httpOnly = false;
  let sameSite = "unspecified";
  let expires: string | null = null;
  for (const attr of attrs) {
    const idx = attr.indexOf("=");
    const key = (idx >= 0 ? attr.slice(0, idx) : attr).trim().toLowerCase();
    const val = idx >= 0 ? attr.slice(idx + 1).trim() : "";
    switch (key) {
      case "domain":
        domain = val;
        break;
      case "path":
        path = val || "/";
        break;
      case "secure":
        secure = true;
        break;
      case "httponly":
        httpOnly = true;
        break;
      case "samesite":
        sameSite = val.toLowerCase();
        break;
      case "expires":
        expires = val;
        break;
    }
  }
  return { name, value, domain, path, secure, httpOnly, sameSite, expires };
}

const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10 MB

const rateLimiter: DistributedRateLimiter = (() => {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    return new UpstashRateLimiter({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
      windowMs: 60_000,
      maxRequests: 100,
    });
  }
  if (process.env.NODE_ENV === "production") {
    console.warn(
      "[proxy] UPSTASH_REDIS_REST_URL not set — falling back to in-memory rate limiter. " +
        "On serverless/Edge this is per-instance and effectively ineffective.",
    );
  }
  const inner = new InMemoryRateLimiter({ windowMs: 60_000, maxRequests: 100 });
  return {
    async check(key: string): Promise<RateLimitResult> {
      return inner.check(key);
    },
  };
})();

// Trust X-Forwarded-For / X-Real-IP only when sitting behind a trusted reverse
// proxy (Vercel/Fly overwrite these headers authoritatively). When an attacker
// can set them, bucketing by XFF lets them bypass the limiter by rotating the
// value — so we fall back to a single shared key instead. Mirrors the clientIp()
// logic in sync-server/src/rate-limiter.ts.
const TRUSTED_PROXY = (): boolean => process.env.TRUSTED_PROXY === "true";

function getRateLimitKey(request: NextRequest): string {
  if (TRUSTED_PROXY()) {
    const forwarded = request.headers.get("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "127.0.0.1";
    return ip;
  }
  // No trusted proxy: ignore client-supplied IP headers entirely. This weakens
  // per-client limiting to a global bucket, but it cannot be bypassed by header
  // rotation. The proxy route is additionally gated by the visitor/service token
  // (see proxy.ts), so the impact of a shared rate-limit key is bounded.
  return "unknown";
}

function validateUrl(rawUrl: string): { valid: boolean; parsed?: URL; error?: string } {
  if (!rawUrl || typeof rawUrl !== "string") {
    return { valid: false, error: "Missing or invalid URL" };
  }
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { valid: false, error: "Missing or invalid URL" };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, error: "Invalid URL format" };
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { valid: false, error: "Only HTTP and HTTPS protocols are allowed" };
  }

  if (!parsed.hostname) {
    return { valid: false, error: "URL must include a hostname" };
  }

  return { valid: true, parsed };
}

function structuredError(message: string, code: string, status: number): NextResponse {
  return NextResponse.json({ error: message, code }, { status });
}

function isFetchNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return /failed to fetch|networkerror|enotfound|econnrefused|econntreset|etimedout|socket hang up|connect.*refused/.test(
    message,
  );
}

function sanitizeUrlForDebug(url: URL): string {
  let sanitized = `${url.protocol}//${url.hostname}`;
  if (url.port) sanitized += `:${url.port}`;
  if (url.pathname && url.pathname !== "/") sanitized += url.pathname;
  if (url.search) sanitized += url.search;
  return sanitized;
}

export async function POST(request: NextRequest) {
  // Declare these in outer scope so the catch block can reference them for
  // useful debug output when things fail.
  let parsedUrl: URL | undefined = undefined;
  let targetUrl = "";
  let debugMode = false;
  let hostOverride: string | undefined;

  // ── Timing metrics ────────────────────────────────────────────────────
  const timings = { dnsMs: 0, connectMs: 0, ttfbMs: 0 };

  try {
    const rateKey = getRateLimitKey(request);
    const rateResult = await rateLimiter.check(rateKey);
    if (!rateResult.allowed) {
      return structuredError("Rate limit exceeded. Try again later.", "RATE_LIMIT_EXCEEDED", 429);
    }

    // ── Body size check ─────────────────────────────────────────────────
    const contentLength = request.headers.get("content-length");
    if (contentLength) {
      const size = parseInt(contentLength, 10);
      if (!isNaN(size) && size > MAX_BODY_SIZE) {
        return structuredError(
          "Request body exceeds the maximum allowed size of 10 MB",
          "BODY_TOO_LARGE",
          413,
        );
      }
    }

    // ── Parse body ───────────────────────────────────────────────────────
    let payload: Record<string, unknown>;
    try {
      payload = await request.json();
    } catch {
      return structuredError("Invalid JSON in request body", "INVALID_JSON", 400);
    }

    // Validate payload against schema
    const validPayload = validateProxyPayload(payload);
    if (!validPayload) {
      return structuredError(
        "Invalid request payload. Check URL, method, and headers.",
        "INVALID_PAYLOAD",
        400,
      );
    }

    const rawUrl = validPayload.url;
    const method = validPayload.method.toUpperCase() as typeof validPayload.method;
    const headers = validPayload.headers || {};
    const payloadBody = validPayload.body;
    debugMode =
      validPayload.debug || String(request.headers.get("x-proxy-debug") || "").trim() === "1";

    // ── Validate URL ─────────────────────────────────────────────────────
    const urlValidation = validateUrl(rawUrl);
    if (!urlValidation.valid) {
      return structuredError(urlValidation.error!, "INVALID_URL", 400);
    }
    // expose these to the outer scope so catch-blocks can reference them for debug
    parsedUrl = urlValidation.parsed!;
    targetUrl = parsedUrl.href;

    // ── SSRF protection ──────────────────────────────────────────────────
    // Allow local testing in development mode or if explicitly enabled
    const env = getServerEnv();
    const allowLocal = process.env.NODE_ENV === "development" || env.ALLOW_LOCAL_HOSTS === "true";

    if (!allowLocal) {
      // 1) Reject bare IP literals that are themselves private.
      if (isIP(parsedUrl.hostname) && isBlockedIp(parsedUrl.hostname)) {
        return structuredError(
          "Requests to private/internal hosts are not allowed",
          "SSRF_BLOCKED",
          403,
        );
      }

      // 2) Resolve DNS once (cached), check the resolved address, and PIN it in the
      //    outbound URL so DNS rebinding between check and fetch cannot
      //    redirect to a private IP. The cache is per-instance — on serverless
      //    each cold start pays the lookup cost; on self-hosted Node the cache
      //    absorbs bursts to the same host.
      const dnsStart = Date.now();
      const address = await resolveCached(parsedUrl.hostname);
      timings.dnsMs = Date.now() - dnsStart;
      if (!address) {
        return structuredError("DNS resolution failed", "DNS_ERROR", 400);
      }
      const resolvedIp = address;

      if (isBlockedIp(resolvedIp)) {
        return structuredError(
          "Requests to private/internal hosts are not allowed (DNS rebinding prevention)",
          "SSRF_BLOCKED",
          403,
        );
      }

      // 3) Rewrite the target URL to use the literal IP, but keep the
      //    original `Host` header so virtualhosts / SNI still match.
      const portPart = parsedUrl.port ? `:${parsedUrl.port}` : "";
      const hostLiteral = isIP(resolvedIp) === 6 ? `[${resolvedIp}]` : resolvedIp;
      targetUrl = `${parsedUrl.protocol}//${hostLiteral}${portPart}${parsedUrl.pathname}${parsedUrl.search}`;
      // Capture the original Host to apply after `finalHeaders` is created.
      hostOverride = parsedUrl.host;
    }

    // ── Prepare headers and body ─────────────────────────────────────────
    const finalHeaders: Record<string, string> = Object.fromEntries(
      Object.entries(headers).map(([key, value]) => [key, String(value)]),
    );

    // SSRF protection: pin Host header to original hostname when IP was rewritten.
    if (hostOverride) {
      finalHeaders["Host"] = hostOverride;
    }

    // debug mode can be requested either via header `x-proxy-debug: 1` or via
    // a `debug: true` boolean in the JSON payload.
    debugMode = String(request.headers.get("x-proxy-debug") || "").trim() === "1";
    if (!debugMode && payload && typeof payload.debug === "boolean") {
      debugMode = Boolean(payload.debug);
    }

    let bodyToSend: string | undefined;
    if (method !== "GET" && payloadBody !== undefined && payloadBody !== null) {
      bodyToSend = typeof payloadBody === "string" ? payloadBody : JSON.stringify(payloadBody);
    }

    if (bodyToSend) {
      const hasContentType = Object.keys(finalHeaders).some(
        (key) => key.toLowerCase() === "content-type",
      );
      if (!hasContentType) {
        finalHeaders["Content-Type"] = "application/json";
      }
    }

    // ── Execute fetch with timeout ───────────────────────────────────────
    const customTimeoutMs = parseInt(request.headers.get("x-proxy-timeout") || "30000", 10);
    const finalTimeoutMs = Math.min(Math.max(customTimeoutMs, 1000), 120000);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), finalTimeoutMs);

    // ── TCP connect probe ───────────────────────────────────────────────
    // Open a throwaway socket to the target host/port in parallel with the
    // fetch so we can surface a real connectMs without adding latency. The
    // probe resolves as soon as TCP connect completes (TLS handshake is part
    // of ttfbMs, not connectMs). On error we fall back to 0.
    const connectHost = new URL(targetUrl).hostname;
    const connectPort = parsedUrl!.port
      ? Number(parsedUrl!.port)
      : parsedUrl!.protocol === "https:"
        ? 443
        : 80;
    const connectProbe = new Promise<number>((resolve) => {
      const probeStart = Date.now();
      const socket = net.connect({ host: connectHost, port: connectPort });
      const done = (ms: number) => {
        try {
          socket.destroy();
        } catch {
          /* noop */
        }
        resolve(ms);
      };
      socket.once("connect", () => done(Math.max(0, Date.now() - probeStart)));
      socket.once("error", () => done(0));
    });

    const startTime = Date.now();
    const response = await fetch(targetUrl, {
      method,
      headers: finalHeaders,
      body: bodyToSend,
      signal: controller.signal,
      // SSRF hardening: do NOT follow redirects automatically. An attacker
      // could host a public URL that responds 302 → http://10.0.0.1/, which
      // fetch would silently follow past our SSRF guard. With redirect:
      // 'manual' we surface the 3xx to the caller, who can decide to
      // re-validate the Location against the SSRF guard before following.
      redirect: "manual",
    }).finally(() => clearTimeout(timeout));

    // SSRF hardening for redirects: when the server responds with a 3xx,
    // validate the Location header against the same SSRF checks that were
    // applied to the original URL. An attacker hosting a public endpoint
    // that 302 -> http://10.0.0.1/ would otherwise bypass the guard.
    const location = response.headers.get("location");
    if (location && response.status >= 300 && response.status < 400) {
      const locValidation = validateUrl(location);
      if (!locValidation.valid) {
        return NextResponse.json(
          {
            error: "blocked_redirect",
            message: `Redirect to blocked destination: ${locValidation.error}`,
            status: 502,
          },
          { status: 502 },
        );
      }
      // Resolve the redirect target and block private/internal hosts, mirroring
      // the SSRF checks applied to the primary URL (IP literals + DNS rebinding).
      const redirectAllowLocal =
        process.env.NODE_ENV === "development" || getServerEnv().ALLOW_LOCAL_HOSTS === "true";
      if (!redirectAllowLocal) {
        const redirectHost = locValidation.parsed!.hostname;
        if (isIP(redirectHost) && isBlockedIp(redirectHost)) {
          return NextResponse.json(
            {
              error: "blocked_redirect",
              message: "Redirect to blocked destination: private/internal IP",
              status: 502,
            },
            { status: 502 },
          );
        }
        const resolvedRedirect = await resolveCached(redirectHost);
        if (!resolvedRedirect || isBlockedIp(resolvedRedirect)) {
          return NextResponse.json(
            {
              error: "blocked_redirect",
              message: "Redirect to blocked destination: private/internal IP",
              status: 502,
            },
            { status: 502 },
          );
        }
      }
    }

    // Real TCP connect time (probe ran concurrently with the fetch above).
    timings.connectMs = await connectProbe;

    // TTFB approximation: time from request start until response headers
    // were received. fetch resolves when headers arrive, which for non-
    // streaming responses is essentially time-to-first-byte.
    // We deliberately do NOT read the body stream here because doing so
    // would corrupt it: subsequent response.text()/arrayBuffer() would
    // miss the consumed chunk, truncating the response body.
    timings.ttfbMs = Math.max(0, Date.now() - startTime);

    const durationMs = Date.now() - startTime;
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    // Parse Set-Cookie headers into structured cookie objects so the UI can
    // display them (mirrors what the Tauri desktop client returns).
    const setCookieHeaders = response.headers.getSetCookie?.() ?? [];
    const cookies = setCookieHeaders.map((raw) => parseSetCookie(raw));

    const contentType = response.headers.get("content-type")?.split(";")[0].toLowerCase() || "";
    const isBinary = /^(image\/|video\/|audio\/|application\/pdf|application\/octet-stream)/.test(
      contentType,
    );
    let body: string;
    let encoding = "utf8";
    let size = 0;

    const MAX_RESPONSE_BODY_SIZE = 5 * 1024 * 1024; // 5 MB
    const truncationSuffix = "\n\n...<Response truncated>";

    // Stream the response body and cancel as soon as the cap is reached,
    // so we don't waste memory buffering a multi-GB payload just to throw
    // 99% of it away. See `lib/security/streaming.ts` for the unit tests.
    const reader = response.body?.getReader();
    if (!reader) {
      body = "";
      size = 0;
    } else {
      const {
        body: buf,
        size: bytesRead,
        truncated,
      } = await readWithCap(reader, MAX_RESPONSE_BODY_SIZE);
      size = bytesRead;
      if (isBinary) {
        body = buf.toString("base64");
        encoding = "base64";
      } else {
        let text = buf.toString("utf8");
        if (truncated) text += truncationSuffix;
        body = text;
      }
      if (truncated) {
        responseHeaders["x-proxy-truncated"] = "1";
      }
    }

    const successPayload: Record<string, unknown> = {
      status: response.status,
      statusText: response.statusText,
      body,
      headers: responseHeaders,
      cookies,
      encoding,
      durationMs,
      size,
      timings,
    };

    if (debugMode) {
      successPayload._debug = {
        requestedUrl: sanitizeUrlForDebug(parsedUrl),
        hostname: parsedUrl.hostname,
        isPrivateHost: isPrivateHost(parsedUrl.hostname),
      };
    }

    return NextResponse.json(successPayload);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return structuredError("Request timed out", "TIMEOUT", 504);
    }

    if (isFetchNetworkError(error)) {
      const resp = structuredError("Upstream request failed", "BAD_GATEWAY", 502);
      if (debugMode) {
        return NextResponse.json(
          {
            ...(await resp.json()),
            _debug: {
              requestedUrl: parsedUrl ? sanitizeUrlForDebug(parsedUrl) : null,
              hostname: parsedUrl?.hostname ?? null,
              error: error instanceof Error ? error.message : String(error),
            },
          },
          { status: 502 },
        );
      }
      return resp;
    }

    const resp = structuredError("Upstream request failed", "INTERNAL_ERROR", 500);
    if (debugMode) {
      return NextResponse.json(
        {
          ...(await resp.json()),
          _debug: {
            requestedUrl: targetUrl,
            hostname: parsedUrl?.hostname ?? null,
            error: error instanceof Error ? error.message : String(error),
          },
        },
        { status: 500 },
      );
    }
    return resp;
  }
}

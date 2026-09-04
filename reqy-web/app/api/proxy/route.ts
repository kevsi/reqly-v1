export const dynamic = "force-dynamic";
export const maxDuration = 60;
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
import { captureRequest, captureResponse, recordCapturedRequest } from "@/lib/capture-middleware";
import { requireCaptureUserId, CaptureAuthError } from "@/lib/capture-auth";
import { isPublicWebDeployment, isOriginAllowedForDesktopCSRF } from "@/lib/environment";
import { getRateLimitKey as sharedRateLimitKey } from "../proxy-ai/lib/rate-limit";
import net, { isIP } from "node:net";
import tls from "node:tls";
import { Agent } from "undici";

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
// proxy (Vercel/Fly overwrite these headers authoritatively). Rate-limit keying
// is shared with the other proxy routes via proxy-ai/lib/rate-limit: it prefers
// the proxy_visitor cookie, then IP headers behind a trusted proxy, and finally
// an anonymous UA bucket — never the old literal "unknown" key, which lumped
// every caller into one bucket a single active client could exhaust (DoS of
// legitimate users via 429).
function getRateLimitKey(request: NextRequest): string {
  return sharedRateLimitKey(request);
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

type UpstreamFailureCode = "TARGET_UNREACHABLE" | "CERTIFICATE_ERROR";

/**
 * Classifie une erreur fetch/undici en remontant la chaîne de `cause`
 * (undici enveloppe les erreurs socket/TLS dans un TypeError "fetch failed").
 */
function classifyUpstreamError(error: unknown): UpstreamFailureCode | null {
  const codes: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current instanceof Error && depth < 5; depth += 1) {
    const code = (current as NodeJS.ErrnoException).code;
    if (typeof code === "string") codes.push(code);
    current = (current as { cause?: unknown }).cause;
  }
  if (
    codes.some((code) =>
      ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "UND_ERR_CONNECT_TIMEOUT"].includes(code),
    )
  ) {
    return "TARGET_UNREACHABLE";
  }
  if (codes.some((code) => code.startsWith("OPENSSL_") || code.includes("CERT_"))) {
    return "CERTIFICATE_ERROR";
  }
  const causeMessage =
    error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
  const message = `${error instanceof Error ? error.message : String(error)} ${causeMessage}`;
  if (/OPENSSL_|CERT_|certificate/i.test(message)) return "CERTIFICATE_ERROR";
  if (
    /ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|connect timeout|socket hang up/i.test(
      message,
    )
  ) {
    return "TARGET_UNREACHABLE";
  }
  return null;
}

function sanitizeUrlForDebug(url: URL): string {
  let sanitized = `${url.protocol}//${url.hostname}`;
  if (url.port) sanitized += `:${url.port}`;
  if (url.pathname && url.pathname !== "/") sanitized += url.pathname;
  if (url.search) sanitized += url.search;
  return sanitized;
}

export async function POST(request: NextRequest) {
  // 🔐 SECURITY (audit 2026-09-03) : garde CSRF desktop. Sans auth en mode
  // desktop, la frontière de confiance est l'origine : un POST cross-origin
  // d'un site visité par l'utilisateur (text/plain = pas de preflight) ne
  // doit jamais atteindre ce proxy. Origin absente = appel non-navigateur.
  if (
    !isPublicWebDeployment() &&
    !isOriginAllowedForDesktopCSRF(request.headers.get("origin"))
  ) {
    return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
  }

  // 🔐 SECURITY: on a public web deployment this endpoint must never act as an
  // unauthenticated open proxy. Authenticate up front (mirrors the capture
  // routes) and reuse the resolved user id for capture attribution below.
  let authenticatedUserId: string | null = null;
  if (isPublicWebDeployment()) {
    try {
      authenticatedUserId = await requireCaptureUserId(request);
    } catch (error) {
      if (error instanceof CaptureAuthError) {
        return NextResponse.json({ error: "Authentication required" }, { status: error.status });
      }
      throw error;
    }
  }

  // Declare these in outer scope so the catch block can reference them for
  // useful debug output when things fail.
  let parsedUrl: URL | undefined = undefined;
  let targetUrl = "";
  let debugMode = false;
  let pinnedDispatcher: Agent | undefined;

  // ── Timing metrics ────────────────────────────────────────────────────
  const timings = {
    dnsMs: 0,
    connectMs: 0,
    tlsMs: 0,
    ttfbMs: 0,
    transferMs: 0,
    uploadMs: 0,
    requestBytes: 0,
    responseBytes: 0,
    connectionReused: false,
  };

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

    // ── Parse body (stream-capped) ───────────────────────────────────────
    // The Content-Length gate above is advisory (chunked bodies lie by
    // omission), so the actual read is capped too: a huge chunked body is
    // rejected as soon as MAX_BODY_SIZE bytes are consumed instead of being
    // buffered entirely in memory.
    let payload: Record<string, unknown>;
    try {
      if (!request.body) {
        return structuredError("Missing JSON in request body", "INVALID_JSON", 400);
      }
      const { body: rawBody, truncated } = await readWithCap(
        request.body.getReader(),
        MAX_BODY_SIZE,
      );
      if (truncated) {
        return structuredError(
          "Request body exceeds the maximum allowed size of 10 MB",
          "BODY_TOO_LARGE",
          413,
        );
      }
      payload = JSON.parse(rawBody.toString("utf8"));
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

      // Keep the hostname in the URL for SNI/certificate validation, but force
      // Undici's socket lookup to use the already validated address.
      targetUrl = parsedUrl.href;
      pinnedDispatcher = new Agent({
        connect: {
          lookup(_hostname, _options, callback) {
            callback(null, resolvedIp, isIP(resolvedIp));
          },
        },
      });
    }

    // ── Prepare headers and body ─────────────────────────────────────────
    const finalHeaders: Record<string, string> = Object.fromEntries(
      Object.entries(headers).map(([key, value]) => [key, String(value)]),
    );

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
    // Client-requested, but capped at 60s so a single request cannot pin a
    // worker for two minutes (rate limit × timeout = worker-seconds DoS).
    const customTimeoutMs = parseInt(request.headers.get("x-proxy-timeout") || "30000", 10);
    const finalTimeoutMs = Math.min(Math.max(customTimeoutMs, 1000), 60000);

    // Track request body size for upload metrics
    timings.requestBytes = bodyToSend ? new TextEncoder().encode(bodyToSend).length : 0;

    // ── Upload timing (phase "Request sent") ──────────────────────────────
    // undici/fetch n'expose pas directement le temps d'écriture du body : on
    // enveloppe celui-ci dans un ReadableStream et on mesure le moment où
    // undici le consomme (≈ fin d'envoi). Content-Length est posé
    // explicitement pour que undici garde une sémantique identique au body
    // string (pas de Transfer-Encoding: chunked).
    let uploadMs = 0;
    const buildBodyStream = (bodyStr: string): ReadableStream<Uint8Array> => {
      const encoder = new TextEncoder();
      const bytes = encoder.encode(bodyStr);
      const uploadStart = Date.now();
      let measured = false;
      const mark = () => {
        if (measured) return;
        measured = true;
        uploadMs = Math.max(0, Date.now() - uploadStart);
      };
      return new ReadableStream({
        pull(controller) {
          controller.enqueue(bytes);
          controller.close();
          mark();
        },
        cancel() {
          mark();
        },
      });
    };
    const toBody = (b: string | undefined) =>
      b !== undefined ? buildBodyStream(b) : undefined;
    if (
      bodyToSend !== undefined &&
      !Object.keys(finalHeaders).some((key) => key.toLowerCase() === "content-length")
    ) {
      finalHeaders["Content-Length"] = String(timings.requestBytes);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), finalTimeoutMs);

    // ── TCP + TLS connect probe ──────────────────────────────────────────
    // Open a throwaway socket to measure TCP connect time, then optionally
    // measure TLS handshake time for HTTPS targets. Both run in parallel
    // with the fetch so we don't add latency.
    const connectHost = new URL(targetUrl).hostname;
    const connectPort = parsedUrl!.port
      ? Number(parsedUrl!.port)
      : parsedUrl!.protocol === "https:"
        ? 443
        : 80;
    const isHttps = parsedUrl!.protocol === "https:";

    const connectProbe = new Promise<{ tcpMs: number; tlsMs: number }>((resolve) => {
      const probeStart = Date.now();
      const socket = net.connect({ host: connectHost, port: connectPort });

      const onConnect = () => {
        const tcpMs = Math.max(0, Date.now() - probeStart);
        if (!isHttps) {
          try { socket.destroy(); } catch { /* noop */ }
          resolve({ tcpMs, tlsMs: 0 });
          return;
        }
        // TLS handshake on the connected socket
        const tlsStart = Date.now();
        const tlsSocket = tls.connect({ socket, servername: connectHost }, () => {
          const tlsMs = Math.max(0, Date.now() - tlsStart);
          try { tlsSocket.destroy(); } catch { /* noop */ }
          resolve({ tcpMs, tlsMs });
        });
        tlsSocket.once("error", () => {
          try { tlsSocket.destroy(); } catch { /* noop */ }
          resolve({ tcpMs, tlsMs: 0 });
        });
      };

      socket.once("connect", onConnect);
      socket.once("error", () => {
        try { socket.destroy(); } catch { /* noop */ }
        resolve({ tcpMs: 0, tlsMs: 0 });
      });
    });
    const startTime = Date.now();
    let response = await fetch(targetUrl, {
      method,
      headers: finalHeaders,
      body: toBody(bodyToSend),
      signal: controller.signal,
      ...(pinnedDispatcher ? { dispatcher: pinnedDispatcher } : {}),
      // SSRF hardening: do NOT follow redirects automatically. An attacker
      // could host a public URL that responds 302 → http://10.0.0.1/, which
      // fetch would silently follow past our SSRF guard. With redirect:
      // 'manual' we surface the 3xx to the caller, who can decide to
      // re-validate the Location against the SSRF guard before following.
      redirect: "manual",
    }).finally(() => clearTimeout(timeout));
    // ── Redirect handling ──────────────────────────────────────────────────
    // With redirect: "manual" a 3xx is surfaced to the caller unless
    // followRedirects is set: then we follow up to MAX_REDIRECTS hops,
    // re-validating every Location against the same SSRF checks applied to
    // the original URL (a public endpoint redirecting to a private host must
    // never be followed silently). When not following, the Location is still
    // validated so the client never receives a pointer to a private host.
    const MAX_REDIRECTS = 5;

    const validateRedirectTarget = async (
      location: string,
      base: string,
    ): Promise<{ url?: string; error?: string }> => {
      const locValidation = validateUrl(new URL(location, base).toString());
      if (!locValidation.valid) {
        return { error: `Redirect to blocked destination: ${locValidation.error}` };
      }
      if (!allowLocal) {
        const redirectHost = locValidation.parsed!.hostname;
        if (isIP(redirectHost) && isBlockedIp(redirectHost)) {
          return { error: "Redirect to blocked destination: private/internal IP" };
        }
        const resolvedRedirect = await resolveCached(redirectHost);
        if (!resolvedRedirect || isBlockedIp(resolvedRedirect)) {
          return { error: "Redirect to blocked destination: private/internal IP" };
        }
      }
      return { url: locValidation.parsed!.href };
    };

    const redirectErrorResponse = (message: string) =>
      NextResponse.json({ error: "blocked_redirect", message, status: 502 }, { status: 502 });

    let redirectsFollowed = 0;
    let location = response.headers.get("location");

    while (
      validPayload.followRedirects === true &&
      response.status >= 300 &&
      response.status < 400 &&
      location &&
      redirectsFollowed < MAX_REDIRECTS
    ) {
      const target = await validateRedirectTarget(location, targetUrl);
      if (target.error) return redirectErrorResponse(target.error);

      // Re-pin the dispatcher to the validated address of the next hop so a
      // DNS rebinding between hops cannot redirect to a private host.
      if (!allowLocal) {
        const address = await resolveCached(new URL(target.url!).hostname);
        if (!address || isBlockedIp(address)) {
          return redirectErrorResponse("Redirect to blocked destination: private/internal IP");
        }
        await pinnedDispatcher?.close().catch(() => undefined);
        pinnedDispatcher = new Agent({
          connect: {
            lookup(_hostname, _options, callback) {
              callback(null, address, isIP(address));
            },
          },
        });
      }

      // 301/302/303 switch to GET without body (HEAD stays HEAD); 307/308
      // preserve method and body.
      let nextMethod = method;
      let nextBody = bodyToSend;
      if (
        (response.status === 301 || response.status === 302 || response.status === 303) &&
        method !== "GET" &&
        method !== "HEAD"
      ) {
        nextMethod = "GET";
        nextBody = undefined;
      }

      targetUrl = target.url!;
      redirectsFollowed += 1;
      response = await fetch(targetUrl, {
        method: nextMethod,
        headers: finalHeaders,
        body: toBody(nextBody),
        signal: controller.signal,
        ...(pinnedDispatcher ? { dispatcher: pinnedDispatcher } : {}),
        redirect: "manual",
      });
      location = response.headers.get("location");
    }

    if (
      validPayload.followRedirects === true &&
      response.status >= 300 &&
      response.status < 400 &&
      location &&
      redirectsFollowed >= MAX_REDIRECTS
    ) {
      return NextResponse.json(
        { error: "too_many_redirects", message: "Too many redirects (max 5)", status: 502 },
        { status: 502 },
      );
    }

    // Not following (or the loop ended on a final 3xx): validate the Location
    // so the client never receives a pointer to a private/internal host.
    if (location && response.status >= 300 && response.status < 400) {
      const target = await validateRedirectTarget(location, targetUrl);
      if (target.error) return redirectErrorResponse(target.error);
    }

    // Real TCP + TLS connect time (probe ran concurrently with the fetch above).
    const probeResult = await connectProbe;
    timings.connectMs = probeResult.tcpMs;
    timings.tlsMs = probeResult.tlsMs;

    // Connection reuse heuristic: if DNS + TCP are near-zero, the Agent
    // likely reused an existing connection from its pool.
    timings.connectionReused = timings.dnsMs + timings.connectMs < 5;

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
    const transferStart = Date.now();
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
      timings.transferMs = Math.max(0, Date.now() - transferStart);
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

    timings.responseBytes = size;
    timings.uploadMs = uploadMs;

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

    // ── Record captured request (if capture is active) ────────────────────
    try {
      const capturedReq = await captureRequest(method, parsedUrl!.href, finalHeaders, bodyToSend);
      const capturedResp = await captureResponse(response.status, responseHeaders, body);
      const rateLimitKey = getRateLimitKey(request); // Reuse same rate-limit key
      // On public deployments the user was already validated at the top of the
      // handler (single validation pass); desktop/self-hosted validate here.
      const captureUserId = authenticatedUserId ?? (await requireCaptureUserId(request));
      await recordCapturedRequest(
        capturedReq,
        capturedResp,
        durationMs,
        rateLimitKey,
        captureUserId,
      );
    } catch (captureError) {
      console.warn("[Capture] Failed to record session:", captureError);
      // Non-blocking: don't fail the request if capture fails
    }

    return NextResponse.json(successPayload);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return structuredError("Request timed out", "TIMEOUT", 504);
    }

    const rawDetailMsg = error instanceof Error ? error.message : String(error);
    // Undici wraps the real socket/TLS error in a generic TypeError("fetch failed"):
    // surface the root cause message too, or the client-side detail is useless.
    const causeDetailMsg =
      error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : "";
    const detailMsg = `${rawDetailMsg}${causeDetailMsg}`;

    // Undici/fetch network failure with a known shape: surface an actionable
    // code instead of the generic BAD_GATEWAY. TIMEOUT (AbortError) is handled
    // above and keeps its own 504.
    const upstreamCode = classifyUpstreamError(error);
    if (upstreamCode) {
      const label =
        upstreamCode === "CERTIFICATE_ERROR"
          ? "Upstream TLS certificate error"
          : "Target host unreachable";
      return structuredError(`${label}: ${detailMsg}`, upstreamCode, 502);
    }

    if (isFetchNetworkError(error)) {
      const resp = structuredError(`Upstream request failed: ${detailMsg}`, "BAD_GATEWAY", 502);
      if (debugMode) {
        return NextResponse.json(
          {
            ...(await resp.json()),
            _debug: {
              requestedUrl: parsedUrl ? sanitizeUrlForDebug(parsedUrl) : null,
              hostname: parsedUrl?.hostname ?? null,
              error: detailMsg,
            },
          },
          { status: 502 },
        );
      }
      return resp;
    }

    const resp = structuredError(`Upstream request failed: ${detailMsg}`, "INTERNAL_ERROR", 500);
    if (debugMode) {
      return NextResponse.json(
        {
          ...(await resp.json()),
          _debug: {
            requestedUrl: targetUrl,
            hostname: parsedUrl?.hostname ?? null,
            error: detailMsg,
          },
        },
        { status: 500 },
      );
    }
    return resp;
  } finally {
    await pinnedDispatcher?.close().catch(() => undefined);
  }
}

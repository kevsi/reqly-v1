import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const PROTECTED_PREFIXES = [
  "/api/proxy",
  "/api/proxy-ai",
  "/api/proxy-models",
  "/api/proxy-sse",
  "/api/test-runner/",
  "/api/postman-import",
  "/api/postman-export",
  "/api/github-import",
  "/api/embed",
  "/api/capture",
  "/api/git/proxy",
  "/api/gitlab-api",
];

function isExempt(pathname: string): boolean {
  if (pathname === "/" || pathname === "/api") return true;
  if (pathname.startsWith("/_next/static/")) return true;
  if (pathname.startsWith("/api/auth/")) return true;
  if (pathname.startsWith("/api/github-auth/")) return true;
  if (pathname.startsWith("/api/jina-auth/")) return true;
  return false;
}

function isProtected(pathname: string): boolean {
  for (const p of PROTECTED_PREFIXES) {
    if (pathname.startsWith(p)) return true;
  }
  return false;
}

function extractBearerToken(authorization: string | null): string | null {
  if (!authorization) return null;
  const match = authorization.match(/^Bearer\s+(.*)$/i);
  if (!match) return null;
  return match[1].trim();
}

// Constant-time string comparison. Edge-safe (no node:crypto available in the
// Next.js 16 proxy runtime): compares every char regardless of matches so a
// caller cannot learn the token length/prefix from response timing. Used for
// the proxy service + visitor token checks below.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

const VISITOR_COOKIE = "proxy_visitor";

// Per-visitor runtime token, issued by this proxy and read back by the
// client at runtime (`lib/proxy-auth.ts`). Unlike a static NEXT_PUBLIC_* env
// var it is never inlined in the bundle, so a cross-site page or third-party
// process cannot extract it. Server-side callers keep using
// PROXY_SERVICE_TOKEN (never exposed to the client bundle).
function getVisitorToken(request: NextRequest): string | null {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader.match(/(?:^|;\s*)proxy_visitor=([^;]+)/);
  if (!match) return null;
  try {
    const value = decodeURIComponent(match[1]);
    return value.length >= 32 ? value : null;
  } catch {
    return null;
  }
}

function isSecureRequest(request: NextRequest): boolean {
  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  return forwardedProto ? forwardedProto === "https" : request.nextUrl.protocol === "https:";
}

function isSameOriginRequest(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return ["GET", "HEAD", "OPTIONS"].includes(request.method);
  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  const protocol = forwardedProto || request.nextUrl.protocol.replace(":", "");
  const host = request.headers.get("host");
  return Boolean(host && origin === `${protocol}://${host}`);
}

function ensureVisitorCookie(response: NextResponse, request: NextRequest): NextResponse {
  if (getVisitorToken(request)) return response;
  const token = crypto.randomUUID(); // 36 chars, > 32 minimum
  const secure = process.env.NODE_ENV === "production" && isSecureRequest(request);
  response.headers.append(
    "Set-Cookie",
    `${VISITOR_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}${
      secure ? "; Secure" : ""
    }`,
  );
  return response;
}

function buildCsp(nonce: string): string {
  const syncUrl = (process.env.NEXT_PUBLIC_SYNC_URL || "https://reqly.duckdns.org").replace(
    /\/$/,
    "",
  );
  let syncConnectTargets = "https://reqly.duckdns.org wss://reqly.duckdns.org";
  try {
    const syncOrigin = new URL(syncUrl).origin;
    const wsScheme = syncOrigin.startsWith("https") ? "wss:" : "ws:";
    syncConnectTargets = `${syncOrigin} ${syncOrigin.replace(/^https?:/, wsScheme)}`;
  } catch {
    // Keep the safe default sync targets when the configured URL is invalid.
  }
  return [
    "default-src 'self'",
    // Nonce-based script-src: Next.js 16 applies the `x-nonce` request header
    // set below to its injected inline scripts, so 'unsafe-inline' is not
    // needed. 'strict-dynamic' trusts scripts loaded by an already-trusted
    // script, which lets lazy-loaded bundles work without a long host allowlist.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    `connect-src 'self' https: wss: http://localhost:* ipc: http://ipc.localhost tauri: https://tauri.localhost ${syncConnectTargets}`,
    "font-src 'self' data:",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "report-uri /api/csp-reports",
    "upgrade-insecure-requests",
  ].join("; ");
}

export function proxy(request: NextRequest): NextResponse {
  const nonce = crypto.randomUUID();
  const { pathname } = request.nextUrl;

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  if (isExempt(pathname)) {
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set("Content-Security-Policy", buildCsp(nonce));
    return ensureVisitorCookie(response, request);
  }

  if (!isProtected(pathname)) {
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set("Content-Security-Policy", buildCsp(nonce));
    return ensureVisitorCookie(response, request);
  }

  const envToken = process.env.PROXY_SERVICE_TOKEN ?? "";
  const envTokenValid = envToken.length >= 32;
  const visitorToken = getVisitorToken(request);

  // Fail closed when no auth is configured at all.
  if (!envTokenValid && !visitorToken) {
    return NextResponse.json({ error: "Service token not configured" }, { status: 503 });
  }

  const bearer = extractBearerToken(request.headers.get("authorization"));

  // Constant-time comparison so token checks don't leak length/prefix via timing.
  // Browser requests use the HttpOnly visitor cookie as the capability.  The
  // cookie is not readable by JavaScript, so requiring a matching bearer would
  // make the real web client fail closed.  State-changing requests still need
  // an explicit same-origin Origin; service callers may use the service token.
  const visitorCookieAuthorized =
    !!visitorToken &&
    (["GET", "HEAD", "OPTIONS"].includes(request.method) || isSameOriginRequest(request));
  const authorized =
    (!!bearer && envTokenValid && safeEqual(bearer, envToken)) ||
    (!!bearer && !!visitorToken && safeEqual(bearer, visitorToken)) ||
    visitorCookieAuthorized;

  if (!authorized) {
    const error = NextResponse.json(
      { error: "Unauthorized", code: "PROXY_AUTH_REQUIRED" },
      { status: 401 },
    );
    return ensureVisitorCookie(error, request);
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", buildCsp(nonce));
  return ensureVisitorCookie(response, request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

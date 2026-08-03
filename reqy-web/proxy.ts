import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const PROTECTED_PREFIXES = [
  "/api/proxy",
  "/api/proxy-ai",
  "/api/proxy-models",
  "/api/test-runner/",
  "/api/postman-import",
  "/api/postman-export",
  "/api/github-import",
  "/api/embed",
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

function buildCsp(nonce: string): string {
  const syncUrl = (process.env.NEXT_PUBLIC_SYNC_URL || "https://reqly.duckdns.org").replace(/\/$/, "");
  let syncConnectTargets = "https://reqly.duckdns.org wss://reqly.duckdns.org";
  try {
    const syncOrigin = new URL(syncUrl).origin;
    const wsScheme = syncOrigin.startsWith("https") ? "wss:" : "ws:";
    syncConnectTargets = `${syncOrigin} ${syncOrigin.replace(/^https?:/, wsScheme)}`;
  } catch {}
  return [
    "default-src 'self'",
    // TODO: Migrate to nonce-based CSP ('nonce-…' + 'strict-dynamic').
    // Currently using 'unsafe-inline' because Next.js 16 does not expose
    // the nonce from middleware to client components.  Once
    // https://github.com/vercel/next.js/issues/56767 is resolved, replace
    // 'unsafe-inline' with "'nonce-{nonce}' 'strict-dynamic'".
    `script-src 'self' 'unsafe-inline' 'nonce-${nonce}'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    `connect-src 'self' https: wss: ipc: http://ipc.localhost tauri: https://tauri.localhost ${syncConnectTargets}`,
    "font-src 'self' data:",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
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
    return response;
  }

  if (!isProtected(pathname)) {
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set("Content-Security-Policy", buildCsp(nonce));
    return response;
  }

  const token = process.env.PROXY_SERVICE_TOKEN;

  if (!token || token.length < 32) {
    return NextResponse.json({ error: "Service token not configured" }, { status: 503 });
  }

  const bearer = extractBearerToken(request.headers.get("authorization"));

  if (!bearer || bearer !== token) {
    return NextResponse.json(
      { error: "Unauthorized", code: "PROXY_AUTH_REQUIRED" },
      { status: 401 },
    );
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", buildCsp(nonce));
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

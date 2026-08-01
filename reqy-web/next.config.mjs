/** @type {import('next').NextConfig} */
import path from "path"
import withBundleAnalyzer from "@next/bundle-analyzer"

const AUTH_SIGNING_SECRET = process.env.AUTH_SIGNING_SECRET
if (!AUTH_SIGNING_SECRET || AUTH_SIGNING_SECRET.length < 32) {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "[env:build] AUTH_SIGNING_SECRET is required in production. Set it in .env.local",
    )
  }
  console.warn('AUTH_SIGNING_SECRET is not set. Using insecure default for development only.')
}

// Allow the configured sync backend as a `connect-src` target. In dev it is
// typically http://localhost:4000 (auth + live sync); in production this is
// https://reqly-sync.fly.dev (wss for the live WebSocket). The explicit origin
// keeps the CSP correct if NEXT_PUBLIC_SYNC_URL is overridden.
const SYNC_URL = (process.env.NEXT_PUBLIC_SYNC_URL || "https://reqly-sync.fly.dev").replace(/\/$/, "")
let syncConnectTargets = "https://reqly-sync.fly.dev wss://reqly-sync.fly.dev"
try {
  const syncOrigin = new URL(SYNC_URL).origin
  const wsScheme = syncOrigin.startsWith("https") ? "wss:" : "ws:"
  syncConnectTargets = `${syncOrigin} ${syncOrigin.replace(/^https?:/, wsScheme)}`
} catch {
  // keep the dev fallback above if the URL is malformed
}

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "geolocation=(), microphone=(), camera=()" },
  // CSP is now set by middleware.ts (nonce-based). This next.config fallback
  // is used only for build-time static pages where middleware doesn't run.
  // The nonce-based CSP in middleware replaces 'unsafe-inline' with
  // 'nonce-<random>' + 'strict-dynamic' for better XSS protection.
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      `connect-src 'self' https: wss: ipc: http://ipc.localhost tauri: https://tauri.localhost ${syncConnectTargets}`,
      "font-src 'self' data:",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "upgrade-insecure-requests",
    ].join("; "),
  },
  // HSTS only in production — breaks dev over plain HTTP otherwise.
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" }]
    : []),
]

// Desktop build is triggered by setting BUILD_TARGET=desktop in the env.
// The `pnpm generate` script sets this via `node scripts/build-desktop.mjs`
// (cross-platform — no `cross-env` dependency required).
//
// On the desktop build (used by Tauri via `pnpm tauri:build`):
//   - `output: 'export'` enables static export for the Tauri WebView
//   - `assetPrefix` points to the local Next.js dev server in dev (TAURI_DEV_HOST)
//   - `headers()` is omitted (no effect with export; CSP lives in tauri.conf.json)
//
// On the web build (Vercel, `pnpm build`):
//   - No `output: 'export'` — full SSR with API routes
//   - No `assetPrefix` — default
//   - `headers()` works normally
const isDesktopBuild = process.env.BUILD_TARGET === 'desktop'
const isProd = process.env.NODE_ENV === 'production'
const internalHost = process.env.TAURI_DEV_HOST ?? 'localhost'

const nextConfig = {
  turbopack: {
    root: path.resolve(process.cwd(), ".."),
  },
  images: {
    unoptimized: true,
  },
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  // Web-only: HTTP security headers (work in SSR, ignored in static export)
  ...(!isDesktopBuild && {
    async headers() {
      return [{ source: "/(.*)", headers: securityHeaders }]
    },
  }),
  // Desktop-only: static export + dev-server asset prefix
  ...(isDesktopBuild && {
    output: 'export',
    // trailingSlash is required with output: 'export' so Next.js emits
    // `out/<route>/index.html` (matching the SPA's expected resolution) and
    // the client-side router can navigate without forcing a hard reload.
    trailingSlash: true,
    assetPrefix: isProd ? '' : `http://${internalHost}:3000`,
  }),
}

// Bundle analyzer: enable with `ANALYZE=true pnpm build`.
// Disabled by default so CI builds stay fast and the report file isn't
// generated unless someone explicitly asks for it.
export default withBundleAnalyzer({ enabled: process.env.ANALYZE === "true" })(nextConfig)

import { NextRequest, NextResponse } from "next/server";
import { createRateLimiter } from "@/lib/rate-limiter";
import { getRateLimitKey } from "../proxy-ai/lib/rate-limit";

/**
 * CSP violation report endpoint.
 *
 * Browsers POST a JSON payload to `report-uri` / `report-to` when they
 * block a resource that violates the Content-Security-Policy. This endpoint
 * logs the violation in dev and silently accepts reports in production.
 *
 * Usage in next.config.mjs:
 *   `report-uri /api/csp-reports`
 *
 * CSP-level (not server-level) rate limiting is handled by the browser
 * (browsers throttle report submission). If this endpoint gets abused at
 * the HTTP layer, wrap it with the in-memory rate limiter.
 */

interface CspReport {
  "csp-report": {
    "document-uri": string;
    referrer?: string;
    "blocked-uri": string;
    "violated-directive": string;
    "effective-directive": string;
    "original-policy": string;
    disposition?: "enforce" | "report";
    "script-sample"?: string;
    "status-code"?: number;
    "source-file"?: string;
    "line-number"?: number;
    "column-number"?: number;
  };
}

export const dynamic = "force-dynamic";
const cspRateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 60 });
const MAX_REPORT_BYTES = 64 * 1024;

export async function POST(request: NextRequest) {
  const rate = await cspRateLimiter.check(getRateLimitKey(request));
  if (!rate.allowed) {
    return new NextResponse(null, {
      status: 429,
      headers: {
        "Retry-After": String(Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000))),
      },
    });
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REPORT_BYTES) {
    return new NextResponse(null, { status: 204 });
  }
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_REPORT_BYTES) {
      return new NextResponse(null, { status: 204 });
    }
    const body = JSON.parse(rawBody) as CspReport;
    const report = body["csp-report"];

    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[csp] violation:",
        report["violated-directive"],
        report["blocked-uri"],
        report["document-uri"],
      );
    }

    // En production, un service externe (Sentry, Datadog, dashboard CSP)
    // peut être branché ici — passer obligatoirement par le guard SSRF
    // partagé (lib/server/safe-fetch) avant toute requête sortante.

    return new NextResponse(null, { status: 204 });
  } catch {
    // Malformed report — still return 204 per spec
    return new NextResponse(null, { status: 204 });
  }
}

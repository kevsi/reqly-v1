import { NextRequest, NextResponse } from "next/server";

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

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CspReport;
    const report = body["csp-report"];

    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[csp] violation:",
        report["violated-directive"],
        report["blocked-uri"],
        report["document-uri"],
      );
    }

    // In production, forward to an external monitoring service if configured.
    // Example: send to Sentry, Datadog, or a dedicated CSP dashboard.
    // if (process.env.CSP_WEBHOOK_URL) {
    //   await fetch(process.env.CSP_WEBHOOK_URL, {
    //     method: "POST",
    //     body: JSON.stringify(report),
    //     headers: { "Content-Type": "application/json" },
    //   })
    // }

    return new NextResponse(null, { status: 204 });
  } catch {
    // Malformed report — still return 204 per spec
    return new NextResponse(null, { status: 204 });
  }
}

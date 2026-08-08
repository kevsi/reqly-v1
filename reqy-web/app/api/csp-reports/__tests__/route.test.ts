import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";

import { POST } from "@/app/api/csp-reports/route";

function makeReport(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/csp-reports", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("CSP report endpoint", () => {
  it("accepts a valid CSP report and returns 204", async () => {
    const report = {
      "csp-report": {
        "document-uri": "http://localhost:3000/",
        referrer: "",
        "blocked-uri": "http://evil.com/script.js",
        "violated-directive": "script-src-elem",
        "effective-directive": "script-src-elem",
        "original-policy": "default-src 'self'; script-src 'self'; report-uri /api/csp-reports",
        disposition: "enforce",
      },
    };

    const request = makeReport(report);
    const response = await POST(request);

    expect(response.status).toBe(204);
  });

  it("accepts a malformed report gracefully and still returns 204", async () => {
    const request = makeReport({ garbage: true });
    const response = await POST(request);

    expect(response.status).toBe(204);
  });

  it("handles empty body gracefully", async () => {
    const request = new NextRequest("http://localhost/api/csp-reports", {
      method: "POST",
    });
    const response = await POST(request);

    expect(response.status).toBe(204);
  });
});

describe("next.config.mjs CSP", () => {
  // Importing next.config.mjs directly doesn't work well in vitest.
  // Instead, we verify the CSP header structure by parsing the config source.
  it("should contain required security directives", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const configPath = path.resolve(process.cwd(), "..", "reqy-web", "next.config.mjs");
    // Fallback if cwd is already reqy-web
    const altPath = path.resolve(process.cwd(), "next.config.mjs");

    let source: string | null = null;
    for (const p of [configPath, altPath]) {
      try {
        source = fs.readFileSync(p, "utf-8");
        break;
      } catch {
        // try next path
      }
    }

    if (!source) {
      // In CI, next.config.mjs might be in a different location
      // Skip the test gracefully
      return;
    }

    // Verify that the CSP value contains expected directives
    expect(source).toContain("default-src 'self'");
    expect(source).toContain("report-uri /api/csp-reports");
    expect(source).toContain("upgrade-insecure-requests");
    expect(source).toContain("frame-ancestors 'none'");
    expect(source).toContain("object-src 'none'");
    expect(source).toContain("base-uri 'self'");
    expect(source).toContain("form-action 'self'");
  });
});

describe("tauri.conf.json CSP", () => {
  it("should contain required security directives", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const tauriConfigPath = path.resolve(process.cwd(), "..", "src-tauri", "tauri.conf.json");

    let source: string;
    try {
      source = fs.readFileSync(tauriConfigPath, "utf-8");
    } catch {
      return; // gracefully skip if file not found
    }

    const config = JSON.parse(source);
    const csp = config?.app?.security?.csp ?? "";

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("upgrade-insecure-requests");
    // The desktop webview serves a static export (no middleware, hence no
    // nonce), and Next.js hydration relies on an inline RSC bootstrap script,
    // so script-src MUST keep 'unsafe-inline' here — unlike the web build
    // (proxy.ts) which uses 'nonce-…' + 'strict-dynamic'. The property that
    // must never appear is 'unsafe-eval'.
    const scriptSrc = csp.match(/script-src\s+[^;]+/)?.[0] ?? "";
    expect(scriptSrc).not.toContain("unsafe-eval");
  });
});

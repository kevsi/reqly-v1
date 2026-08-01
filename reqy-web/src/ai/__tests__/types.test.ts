import { describe, it, expect } from "vitest";
import type {
  RequestContext,
  Diagnostic,
  Fix,
  Rule,
  Severity,
  Confidence,
  DiagnosticSource,
} from "@/src/ai/types";

describe("AI types compile correctly", () => {
  it("RequestContext accepts full payload", () => {
    const ctx: RequestContext = {
      request: {
        method: "GET",
        url: "https://api.example.com",
        headers: { authorization: "Bearer x" },
        body: null,
        authType: "bearer",
      },
      response: {
        status: 200,
        statusText: "OK",
        headers: { "content-type": "application/json" },
        body: { ok: true },
        duration: 42,
        size: 12,
      },
      timestamp: Date.now(),
    };
    expect(ctx.request.method).toBe("GET");
  });

  it("RequestContext supports error-only (no response)", () => {
    const ctx: RequestContext = {
      request: { method: "GET", url: "https://x", headers: {}, body: null, authType: "none" },
      error: { message: "ECONNREFUSED", code: "ECONNREFUSED", type: "network" },
      timestamp: Date.now(),
    };
    expect(ctx.error?.code).toBe("ECONNREFUSED");
  });

  it("Diagnostic with fix is constructible", () => {
    const fix: Fix = {
      type: "header",
      description: "Add Bearer token",
      patch: { headers: { authorization: "Bearer {{token}}" } },
      applyFix: () => ({ headers: { authorization: "Bearer new" } }),
    };
    const diag: Diagnostic = {
      id: "test-1",
      severity: "error",
      category: "auth",
      title: "Missing token",
      explanation: "...",
      fix,
      confidence: "certain",
      source: "local",
      timestamp: Date.now(),
    };
    expect(diag.fix?.applyFix()).toEqual({ headers: { authorization: "Bearer new" } });
  });

  it("Rule interface is satisfied by a minimal rule", () => {
    const rule: Rule = {
      id: "test.rule",
      category: "auth",
      severity: "warning",
      match: () => true,
      build: () => ({ severity: "warning", category: "auth", title: "t", explanation: "e", confidence: "probable" }),
    };
    expect(rule.match({ request: { method: "GET", url: "", headers: {}, body: null, authType: "none" }, timestamp: 0 })).toBe(true);
  });
});

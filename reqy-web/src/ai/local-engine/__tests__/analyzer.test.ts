import { describe, it, expect } from "vitest";
import { analyze } from "@/src/ai/local-engine/analyzer";
import type { RequestContext } from "@/src/ai/types";

const baseReq = { method: "GET" as const, url: "https://x", headers: {}, body: null, authType: "none" as const };

describe("analyze", () => {
  it("returns no diagnostics for a healthy 200 response", () => {
    const ctx: RequestContext = {
      request: baseReq,
      response: { status: 200, statusText: "OK", headers: {}, body: {}, duration: 50, size: 100 },
      timestamp: Date.now(),
    };
    const diags = analyze(ctx);
    expect(diags.length).toBe(0);
  });

  it("returns diagnostic for 401 missing token", () => {
    const ctx: RequestContext = {
      request: baseReq,
      response: { status: 401, statusText: "", headers: { "www-authenticate": "Bearer" }, body: {}, duration: 10, size: 0 },
      timestamp: Date.now(),
    };
    const diags = analyze(ctx);
    expect(diags.some((d) => d.id === "auth.401.bearer.missing")).toBe(true);
  });

  it("deduplicates diagnostics with same id", () => {
    const ctx: RequestContext = {
      request: { ...baseReq, headers: { authorization: "Bearer x" } },
      response: { status: 401, statusText: "", headers: {}, body: { message: "token expired" }, duration: 10, size: 0 },
      timestamp: Date.now(),
    };
    const diags = analyze(ctx);
    const ids = diags.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("runs in under 50ms for typical context", () => {
    const ctx: RequestContext = {
      request: { ...baseReq, headers: { authorization: "Bearer abc" } },
      response: { status: 500, statusText: "", headers: {}, body: { message: "oops" }, duration: 10, size: 0 },
      timestamp: Date.now(),
    };
    const start = performance.now();
    analyze(ctx);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
  });

  it("sorts diagnostics by severity (error > warning > info)", () => {
    const ctx: RequestContext = {
      request: baseReq,
      response: { status: 200, statusText: "", headers: {}, body: {}, duration: 12000, size: 0 },
      timestamp: Date.now(),
    };
    const diags = analyze(ctx);
    const sev = diags.map((d) => d.severity);
    const order = { error: 0, warning: 1, info: 2 } as const;
    for (let i = 1; i < sev.length; i++) {
      expect(order[sev[i] as keyof typeof order]).toBeGreaterThanOrEqual(order[sev[i - 1] as keyof typeof order]);
    }
  });
});

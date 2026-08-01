import { describe, it, expect } from "vitest";
import { performanceRules } from "@/src/ai/local-engine/rules/performance";
import type { RequestContext } from "@/src/ai/types";

const rule = (id: string) => performanceRules.find((r) => r.id === id)!;

describe("performance.timeout.warning", () => {
  it("matches when duration > 5000ms", () => {
    const ctx: RequestContext = { request: { method: "GET", url: "x", headers: {}, body: null, authType: "none" }, response: { status: 200, statusText: "", headers: {}, body: {}, duration: 6000, size: 0 }, timestamp: 0 };
    expect(rule("performance.timeout.warning").match(ctx)).toBe(true);
  });
});

describe("performance.429.with_retry_after", () => {
  it("matches when 429 + Retry-After header", () => {
    const ctx: RequestContext = { request: { method: "GET", url: "x", headers: {}, body: null, authType: "none" }, response: { status: 429, statusText: "Too Many Requests", headers: { "retry-after": "60" }, body: {}, duration: 10, size: 0 }, timestamp: 0 };
    expect(rule("performance.429.with_retry_after").match(ctx)).toBe(true);
  });
});

describe("performance.body.large", () => {
  it("matches when response body > 1MB", () => {
    const ctx: RequestContext = { request: { method: "GET", url: "x", headers: {}, body: null, authType: "none" }, response: { status: 200, statusText: "", headers: {}, body: {}, duration: 0, size: 2 * 1024 * 1024 }, timestamp: 0 };
    expect(rule("performance.body.large").match(ctx)).toBe(true);
  });
});

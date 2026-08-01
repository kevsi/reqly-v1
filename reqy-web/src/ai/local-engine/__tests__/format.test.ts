import { describe, it, expect } from "vitest";
import { formatRules } from "@/src/ai/local-engine/rules/format";
import type { RequestContext } from "@/src/ai/types";

function ctx(overrides: Partial<RequestContext>): RequestContext {
  return {
    request: { method: "POST", url: "https://x", headers: {}, body: null, authType: "none" },
    timestamp: Date.now(),
    ...overrides,
  } as RequestContext;
}

describe("format.415.missing_content_type", () => {
  const rule = formatRules.find((r) => r.id === "format.415.missing_content_type")!;
  it("matches when 415 + POST/PUT/PATCH + no Content-Type", () => {
    expect(rule.match(ctx({
      request: { method: "POST", url: "https://x", headers: {}, body: { x: 1 }, authType: "none" },
      response: { status: 415, statusText: "Unsupported Media Type", headers: {}, body: {}, duration: 10, size: 0 },
    }))).toBe(true);
  });
  it("does not match when Content-Type is present", () => {
    expect(rule.match(ctx({
      request: { method: "POST", url: "https://x", headers: { "content-type": "application/json" }, body: {}, authType: "none" },
      response: { status: 415, statusText: "", headers: {}, body: {}, duration: 0, size: 0 },
    }))).toBe(false);
  });
});

describe("format.422.validation", () => {
  const rule = formatRules.find((r) => r.id === "format.422.validation")!;
  it("matches when 422 + body contains errors array", () => {
    expect(rule.match(ctx({
      response: { status: 422, statusText: "Unprocessable Entity", headers: {}, body: { errors: [{ field: "email", message: "required" }] }, duration: 10, size: 50 },
    }))).toBe(true);
  });
});

describe("format.413.payload_too_large", () => {
  const rule = formatRules.find((r) => r.id === "format.413.payload_too_large")!;
  it("matches when 413", () => {
    expect(rule.match(ctx({ response: { status: 413, statusText: "", headers: {}, body: {}, duration: 0, size: 0 } }))).toBe(true);
  });
});

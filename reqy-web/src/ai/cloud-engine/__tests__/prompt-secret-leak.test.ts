import { describe, it, expect } from "vitest";
import { buildContextSummary } from "@/src/ai/cloud-engine/prompt";
import type { RequestContext } from "@/src/ai/types";

function makeCtx(over: Partial<RequestContext> = {}): RequestContext {
  return {
    request: {
      method: "GET",
      url: "https://api.example.com/me",
      headers: {},
      body: null,
      authType: "bearer",
    },
    timestamp: 0,
    ...over,
  };
}

describe("buildContextSummary — bug #1 (auth header leak to LLM)", () => {
  it("A: masks secret REQUEST headers (Authorization / api key) before they reach the LLM", () => {
    const ctx = makeCtx({
      request: {
        method: "GET",
        url: "https://api.example.com/me",
        headers: { Authorization: "Bearer sk-secret-123", "X-Api-Key": "key-abc-999" },
        body: null,
        authType: "bearer",
      },
    });
    const summary = buildContextSummary(ctx);
    expect(summary).not.toContain("sk-secret-123");
    expect(summary).not.toContain("key-abc-999");
    expect(summary).toContain("••••••");
  });

  it("B: masks secret RESPONSE headers (Set-Cookie) before they reach the LLM", () => {
    const ctx = makeCtx({
      response: {
        status: 200,
        statusText: "OK",
        headers: {
          "Set-Cookie": "session=xyz-secure; Secure",
          "X-Amz-Security-Token": "tok-999",
        },
        body: "ok",
        duration: 10,
        size: 2,
      },
    });
    const summary = buildContextSummary(ctx);
    expect(summary).not.toContain("session=xyz-secure");
    expect(summary).not.toContain("tok-999");
    expect(summary).toContain("••••••");
  });
});

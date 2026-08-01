import { describe, it, expect } from "vitest";
import { detectAuth, headersForAuth, applyAuthHeaders } from "@/src/ai/cloud-engine/auth-detect";

describe("detectAuth", () => {
  it("detects GitHub via URL pattern", () => {
    const r = detectAuth("https://api.github.com/user");
    expect(r.authType).toBe("bearer");
    expect(r.headers.Authorization).toBe("Bearer {{GITHUB_TOKEN}}");
    expect(r.confidence).toBeGreaterThan(0.9);
  });

  it("detects Stripe", () => {
    const r = detectAuth("https://api.stripe.com/v1/charges");
    expect(r.authType).toBe("bearer");
    expect(r.headers.Authorization).toContain("{{STRIPE_API_KEY}}");
  });

  it("detects Anthropic with anthropic-version header", () => {
    const r = detectAuth("https://api.anthropic.com/v1/messages");
    expect(r.authType).toBe("bearer");
    expect(r.headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("hint keyword 'OAuth2' takes precedence", () => {
    const r = detectAuth("https://example.com/api", "use OAuth2 flow");
    expect(r.authType).toBe("oauth2");
  });

  it("hint keyword 'API key' → apikey", () => {
    const r = detectAuth("https://example.com/api", "send api key in header");
    expect(r.authType).toBe("apikey");
  });

  it("hint keyword 'Basic auth' → basic", () => {
    const r = detectAuth("https://example.com/api", "Basic auth with username/password");
    expect(r.authType).toBe("basic");
  });

  it("hint keyword 'Bearer token' → bearer", () => {
    const r = detectAuth("https://example.com/api", "send a Bearer JWT token");
    expect(r.authType).toBe("bearer");
  });

  it("falls back to 'none' for unknown URLs without hint", () => {
    const r = detectAuth("https://random-site.example/foo");
    expect(r.authType).toBe("none");
    expect(r.confidence).toBeLessThan(0.5);
  });
});

describe("headersForAuth", () => {
  it("returns Bearer for bearer", () => {
    expect(headersForAuth("bearer").Authorization).toContain("Bearer");
  });
  it("returns Basic for basic", () => {
    expect(headersForAuth("basic").Authorization).toContain("Basic");
  });
  it("returns X-API-Key for apikey", () => {
    expect(headersForAuth("apikey")["X-API-Key"]).toBeDefined();
  });
  it("returns empty for none", () => {
    expect(headersForAuth("none")).toEqual({});
  });
});

describe("applyAuthHeaders", () => {
  it("merges detected under existing (existing wins)", () => {
    const out = applyAuthHeaders(
      { Authorization: "Bearer existing" },
      {
        authType: "bearer",
        headers: { Authorization: "Bearer {{API_TOKEN}}" },
        confidence: 1,
      }
    );
    expect(out.Authorization).toBe("Bearer existing");
  });

  it("returns existing unchanged for 'none' auth", () => {
    const existing = { "X-Foo": "bar" };
    const out = applyAuthHeaders(existing, { authType: "none", headers: {}, confidence: 1 });
    expect(out).toEqual(existing);
  });

  it("adds new headers without overwriting existing keys", () => {
    const out = applyAuthHeaders(
      { "X-Custom": "value" },
      {
        authType: "bearer",
        headers: { Authorization: "Bearer x" },
        confidence: 1,
      }
    );
    expect(out["X-Custom"]).toBe("value");
    expect(out.Authorization).toBe("Bearer x");
  });
});

import { describe, it, expect } from "vitest";
import {
  buildTestSuggestionsPrompt,
  isValidSuggestion,
  type TestAssertionSuggestion,
} from "@/src/ai/cloud-engine/test-suggestions";

describe("buildTestSuggestionsPrompt", () => {
  it("includes method, url, and category instructions", () => {
    const prompt = buildTestSuggestionsPrompt({
      method: "POST",
      url: "https://api.example.com/users",
      lastStatus: 201,
    });
    expect(prompt).toContain("POST");
    expect(prompt).toContain("https://api.example.com/users");
    expect(prompt).toContain("NOMINAL");
    expect(prompt).toContain("ERROR");
    expect(prompt).toContain("EDGE");
  });

  it("filters out the Authorization header from summary", () => {
    const prompt = buildTestSuggestionsPrompt({
      method: "GET",
      url: "https://x",
      headers: { Authorization: "Bearer SECRET", Accept: "application/json" },
    });
    expect(prompt).toContain("Accept");
    expect(prompt).not.toContain("Bearer SECRET");
  });

  it("truncates body at 400 chars", () => {
    const bigBody = "x".repeat(1000);
    const prompt = buildTestSuggestionsPrompt({ method: "POST", url: "https://x", body: bigBody });
    expect(prompt).toContain("xxx");
    // Should NOT contain all 1000 x's
    expect((prompt.match(/x/g) ?? []).length).toBeLessThan(500);
  });

  it("handles missing body gracefully", () => {
    const prompt = buildTestSuggestionsPrompt({ method: "GET", url: "https://x" });
    expect(prompt).toContain("(no body)");
  });
});

describe("isValidSuggestion", () => {
  const valid: TestAssertionSuggestion = {
    category: "nominal",
    label: "Status is 200",
    code: "expect(response.status).toBe(200);",
  };

  it("accepts a valid suggestion", () => {
    expect(isValidSuggestion(valid)).toBe(true);
  });

  it("rejects unknown category", () => {
    expect(isValidSuggestion({ ...valid, category: "unknown" })).toBe(false);
  });

  it("rejects empty label", () => {
    expect(isValidSuggestion({ ...valid, label: "" })).toBe(false);
  });

  it("rejects empty code", () => {
    expect(isValidSuggestion({ ...valid, code: "" })).toBe(false);
  });

  it("rejects null / non-objects", () => {
    expect(isValidSuggestion(null)).toBe(false);
    expect(isValidSuggestion("string")).toBe(false);
    expect(isValidSuggestion(42)).toBe(false);
  });
});

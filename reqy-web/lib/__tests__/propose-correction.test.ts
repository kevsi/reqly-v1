import { describe, it, expect, vi } from "vitest";
import {
  proposeAssertionCorrection,
  assertionToInput,
  suggestionToAssertion,
  convertSuggestion,
  evaluateSuggestionCompleteness,
  assertionMatchesResult,
} from "@/src/ai/cloud-engine/actions/propose-correction";
import type { Assertion } from "@/lib/test-runner/types";
import type { TestResult } from "@/lib/types";

function mockAskAIWith(suggestion: unknown, rationale = "The response differs.") {
  return vi.fn().mockResolvedValue(JSON.stringify({ suggestion, rationale }));
}

describe("proposeAssertionCorrection", () => {
  it("suggests a corrected assertion without applying it", async () => {
    const askAI = mockAskAIWith({
      expr: "status == 404",
      type: "status",
      target: "status",
      value: 404,
    });
    const out = await proposeAssertionCorrection(
      {
        assertion: { expr: "status == 200" },
        response: { status: 404 },
        endpoint: "GET /x",
      },
      askAI,
    );
    expect(out.suggestion).toBeDefined();
    expect(out.suggestion.expr).not.toBe("status == 200");
    expect(out.suggestion.expr).toBe("status == 404");
    expect(out.rationale).toBeTruthy();
  });

  it("invokes askAI exactly once and performs no mutating dispatch", async () => {
    const askAI = mockAskAIWith({ expr: "status == 404" });
    await proposeAssertionCorrection(
      {
        assertion: { expr: "status == 200" },
        response: { status: 404 },
        endpoint: "GET /x",
      },
      askAI,
    );
    // The function must never reach the network/dispatch directly: it only
    // calls the injected askAI (mock) and parses the result.
    expect(askAI).toHaveBeenCalledTimes(1);
  });

  it("falls back to parsing a JSON object embedded in surrounding text", async () => {
    const askAI = vi
      .fn()
      .mockResolvedValue(
        'Voici la correction : {"suggestion":{"expr":"status == 404"},"rationale":"r"}',
      );
    const out = await proposeAssertionCorrection(
      { assertion: { expr: "status == 200" }, response: { status: 404 }, endpoint: "GET /x" },
      askAI,
    );
    expect(out.suggestion.expr).toBe("status == 404");
  });

  it("throws a readable error when the AI output is not parseable", async () => {
    const askAI = vi.fn().mockResolvedValue("not json at all");
    await expect(
      proposeAssertionCorrection(
        { assertion: { expr: "status == 200" }, response: { status: 404 }, endpoint: "GET /x" },
        askAI,
      ),
    ).rejects.toThrow();
  });
});

describe("assertionToInput / suggestionToAssertion / convertSuggestion", () => {
  it("round-trips a status assertion through the correction shape", () => {
    const original: Assertion = { type: "status", expected: 200 };
    const input = assertionToInput(original);
    expect(input).toEqual({ type: "status", target: "status", value: 200 });
    const corrected = convertSuggestion({ type: "status", value: 404 }, original);
    expect(corrected).toEqual({
      status: "ok",
      assertion: { type: "status", expected: 404 },
    });
    // Legacy wrapper keeps returning the bare Assertion.
    expect(suggestionToAssertion({ type: "status", value: 404 }, original)).toEqual({
      type: "status",
      expected: 404,
    });
  });

  it("converts a jsonPath suggestion back to an Assertion", () => {
    const original: Assertion = {
      type: "jsonPath",
      path: "$.user.id",
      operator: "equals",
      value: "1",
    };
    const corrected = convertSuggestion(
      { type: "jsonPath", target: "$.user.id", operator: "contains", value: "1" },
      original,
    );
    expect(corrected).toEqual({
      status: "ok",
      assertion: {
        type: "jsonPath",
        path: "$.user.id",
        operator: "contains",
        value: "1",
      },
    });
  });

  it("parses a status from an expr string when no structured value is given", () => {
    const original: Assertion = { type: "status", expected: 200 };
    const corrected = convertSuggestion({ expr: "status == 404" }, original);
    expect(corrected).toEqual({
      status: "ok",
      assertion: { type: "status", expected: 404 },
    });
  });
});

describe("incomplete suggestions are refused, never trivialized", () => {
  it("convertSuggestion refuses a status suggestion without usable expected value", () => {
    const original: Assertion = { type: "status", expected: 500 };
    const out = convertSuggestion({}, original);
    expect(out.status).toBe("incomplete");
    if (out.status === "incomplete") {
      expect(out.reason).toBe("no_usable_expected_status");
    }
  });

  it("never silently falls back to the trivial expected:200 (strict path)", () => {
    const original: Assertion = { type: "status", expected: 500 };
    const out = convertSuggestion({ expr: "no digits here" }, original);
    expect(out).not.toEqual({
      status: "ok",
      assertion: { type: "status", expected: 200 },
    });
  });

  it("legacy wrapper resolves incomplete to the original, not to 200", () => {
    const original: Assertion = { type: "status", expected: 500 };
    expect(suggestionToAssertion({}, original)).toEqual(original);
    expect(suggestionToAssertion({ expr: "nothing" }, original)).not.toEqual({
      type: "status",
      expected: 200,
    });
  });

  it("flags a non-numeric responseTime value as incomplete", () => {
    const original: Assertion = { type: "responseTime", operator: "<", valueMs: 300 };
    const out = convertSuggestion({ type: "responseTime", operator: "<" }, original);
    expect(out.status).toBe("incomplete");
    if (out.status === "incomplete") {
      expect(out.reason).toBe("no_usable_response_time_value");
    }
  });

  it("evaluateSuggestionCompleteness mirrors the conversion rules", () => {
    expect(evaluateSuggestionCompleteness({ type: "status", value: 201 })).toEqual({
      complete: true,
    });
    expect(evaluateSuggestionCompleteness({}, "status")).toEqual({
      complete: false,
      reason: "no_usable_expected_status",
    });
    expect(evaluateSuggestionCompleteness({ type: "responseTime" })).toEqual({
      complete: false,
      reason: "no_usable_response_time_value",
    });
    // jsonPath keeps the original anchor — always convertible.
    expect(evaluateSuggestionCompleteness({}, "jsonPath")).toEqual({ complete: true });
  });
});

describe("assertionMatchesResult — index-anchor guard", () => {
  it("matches when the stored assertion still corresponds to the result", () => {
    const original: Assertion = { type: "status", expected: 404 };
    const result: TestResult = {
      assertionId: "status-2",
      type: "status",
      target: "status",
      expected: "404",
      passed: false,
      message: "",
    };
    expect(assertionMatchesResult(original, result)).toBe(true);
  });

  it("rejects when the stored assertion drifted from the displayed one", () => {
    const original: Assertion = { type: "status", expected: 200 };
    const result: TestResult = {
      assertionId: "status-2",
      type: "status",
      target: "status",
      expected: "404",
      passed: false,
      message: "",
    };
    expect(assertionMatchesResult(original, result)).toBe(false);
  });

  it("matches jsonPath assertions on path, operator and value", () => {
    const original: Assertion = {
      type: "jsonPath",
      path: "$.id",
      operator: "equals",
      value: "1",
    };
    const base: Omit<TestResult, "target" | "expected"> = {
      assertionId: "jsonPath-0",
      type: "jsonPath",
      passed: false,
      message: "",
    };
    expect(
      assertionMatchesResult(original, {
        ...base,
        target: "$.id",
        expected: 'equals "1"',
      }),
    ).toBe(true);
    expect(
      assertionMatchesResult(original, { ...base, target: "$.other", expected: 'equals "1"' }),
    ).toBe(false);
    expect(
      assertionMatchesResult(original, { ...base, target: "$.id", expected: 'equals "2"' }),
    ).toBe(false);
  });
});

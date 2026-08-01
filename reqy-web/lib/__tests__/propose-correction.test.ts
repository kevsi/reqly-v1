import { describe, it, expect, vi } from "vitest";
import {
  proposeAssertionCorrection,
  assertionToInput,
  suggestionToAssertion,
} from "@/src/ai/engine/propose-correction";
import type { Assertion } from "@/lib/test-runner/types";

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

describe("assertionToInput / suggestionToAssertion", () => {
  it("round-trips a status assertion through the correction shape", () => {
    const original: Assertion = { type: "status", expected: 200 };
    const input = assertionToInput(original);
    expect(input).toEqual({ type: "status", target: "status", value: 200 });
    const corrected = suggestionToAssertion({ type: "status", value: 404 }, original);
    expect(corrected).toEqual({ type: "status", expected: 404 });
  });

  it("converts a jsonPath suggestion back to an Assertion", () => {
    const original: Assertion = {
      type: "jsonPath",
      path: "$.user.id",
      operator: "equals",
      value: "1",
    };
    const corrected = suggestionToAssertion(
      { type: "jsonPath", target: "$.user.id", operator: "contains", value: "1" },
      original,
    );
    expect(corrected).toEqual({
      type: "jsonPath",
      path: "$.user.id",
      operator: "contains",
      value: "1",
    });
  });

  it("parses a status from an expr string when no structured value is given", () => {
    const original: Assertion = { type: "status", expected: 200 };
    const corrected = suggestionToAssertion({ expr: "status == 404" }, original);
    expect(corrected).toEqual({ type: "status", expected: 404 });
  });
});

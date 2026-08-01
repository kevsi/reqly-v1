import { evaluateStructuredAssertions } from "@reqly/shared/assertions";
import type { Assertion, AssertionResult } from "./types.js";
import type { RunResult } from "./types.js";

export interface AssertionContext {
  status: number;
  durationMs: number;
  headers: Record<string, string>;
  body?: string;
}

export function evaluateAssertions(
  assertions: Assertion[],
  context: AssertionContext,
): AssertionResult[] {
  return evaluateStructuredAssertions(
    assertions as Parameters<typeof evaluateStructuredAssertions>[0],
    context,
  ) as AssertionResult[];
}

export function runResultToAssertionContext(result: RunResult): AssertionContext {
  return {
    status: result.status,
    durationMs: result.durationMs,
    headers: {},
    body: result.body,
  };
}

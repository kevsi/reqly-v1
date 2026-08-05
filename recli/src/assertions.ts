// Re-export shim — implementation moved to @reqly/shared/assertions
//
// Existing recli callers expect:
//   - evaluateAssertion(assertion, result, vars?)  (text-format)
//   - evaluateAssertions(assertions, result, vars?) (text-format, batch)
//   - evaluateSchemaAssertion(schema, body)        (JSON Schema)
//   - assertsPassed(results)
//
// The unified API in @reqly/shared preserves those signatures by adapting
// RunResult → UnifiedEvalContext internally.

import type { AssertionResult, RunResult } from "./types.js";
import {
  evaluateAssertion as evaluateAssertionUnified,
  evaluateAssertions as evaluateAssertionsUnified,
  evaluateSchemaAssertion as evaluateSchemaAssertionShared,
  assertsPassed as assertsPassedShared,
} from "@reqly/shared/assertions";

function toUnifiedCtx(result: RunResult) {
  return {
    status: result.status,
    durationMs: result.durationMs,
    headers: result.responseHeaders ?? {},
    body: result.body,
  };
}

// Unified dispatcher: accepts text `expr`, structured `type`, `schema`, and —
// via normalizeAssertion — bare strings and Newman-style shorthand such as
// { type: "status", expect: 200 } or "status == 200".
export function evaluateAssertion(
  assertion: unknown,
  result: RunResult,
  vars?: Map<string, string>,
): AssertionResult {
  return evaluateAssertionUnified(assertion, toUnifiedCtx(result), {
    vars,
  }) as unknown as AssertionResult;
}

export function evaluateAssertions(
  assertions: unknown[],
  result: RunResult,
  vars?: Map<string, string>,
): AssertionResult[] {
  return evaluateAssertionsUnified(assertions, toUnifiedCtx(result), {
    vars,
  }) as unknown as AssertionResult[];
}

export { evaluateSchemaAssertion } from "@reqly/shared/assertions";
export const assertsPassed = assertsPassedShared;

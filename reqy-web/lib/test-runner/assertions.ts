import { evaluateStructuredAssertion, evaluateSchemaAssertion } from "@reqly/shared/assertions";
import type { UnifiedEvalContext } from "@reqly/shared/assertions";
import type { Assertion, AssertionResult, RequestResponse } from "./types";

// ── Operator mapping (reqy-web → shared) ────────────────────

const operatorMap: Record<string, string> = {
  "<": "lt",
  "<=": "lte",
  ">": "gt",
  ">=": "gte",
  equals: "eq",
  contains: "contains",
  exists: "exists",
  notExists: "notExists",
};

// ── Context adapter ────────────────────────────────────────

function toContext(r: RequestResponse): UnifiedEvalContext {
  return {
    status: r.statusCode ?? 0,
    body: typeof r.body === "string" ? r.body : JSON.stringify(r.body),
    headers: r.headers ?? {},
    durationMs: r.responseTimeMs ?? 0,
  };
}

// ── Assertion normalisation (reqy-web → shared) ───────────

function normalize(a: Assertion): Record<string, unknown> {
  switch (a.type) {
    case "status":
      return { ...a, type: "status-code", value: a.expected };
    case "responseTime":
      return {
        ...a,
        type: "response-time",
        value: String(a.valueMs),
        operator: operatorMap[a.operator] ?? a.operator,
      };
    case "jsonPath":
      return {
        ...a,
        type: "json-path",
        target: a.path,
        operator: operatorMap[a.operator] ?? a.operator,
      };
    default:
      return a;
  }
}

// ── Public API ─────────────────────────────────────────────

/**
 * Evaluate a list of reqy-web assertions against a response.
 * Delegates to the shared @reqly/shared/assertions engine after
 * normalising types. The result's `assertion` field always carries
 * the **original** (pre-normalisation) assertion for downstream
 * consumers that inspect `result.assertion.type`, `expected`, etc.
 */
export function evaluateAssertions(
  assertions: Assertion[],
  response: RequestResponse,
): AssertionResult[] {
  const ctx = toContext(response);
  return assertions.map((a) => {
    let result: { passed: boolean; actualValue?: unknown; error?: string };

    if (a.type === "schema") {
      result = evaluateSchemaAssertion(a.schema, ctx.body);
    } else {
      result = evaluateStructuredAssertion(
        normalize(a) as unknown as Parameters<typeof evaluateStructuredAssertion>[0],
        ctx,
      );
    }

    // Preserve the original assertion so callers (e.g. toTestResults)
    // can read `type: "status"`, `expected`, `path`, etc.
    return {
      assertion: a,
      passed: result.passed,
      actualValue: result.actualValue,
      error: result.error,
    };
  });
}

import { describe, it, expect } from "vitest";
import {
  evaluateAssertion,
  evaluateAssertions,
  evaluateTextAssertion,
  evaluateTextAssertions,
  evaluateStructuredAssertion,
  evaluateStructuredAssertions,
  evaluateSchemaAssertion,
  assertsPassed,
  runResultToContext,
  resolveField,
  compareValues,
  tokenize,
  parseExpectedValue,
  resolveVars,
  validateSchema,
} from "../index.js";
import type { Assertion } from "../../types.js";

// Helper to build a structured assertion. Casts via Record to allow
// object shapes like { in: [200, 201] } on the value field at runtime.
function structuredAssertion(overrides: Record<string, unknown>): Assertion {
  return { type: "status-code", value: "200", ...overrides } as unknown as Assertion;
}
import type { UnifiedEvalContext } from "../index.js";

function makeContext(
  overrides: Partial<{
    status: number;
    body: string | undefined;
    headers: Record<string, string>;
    durationMs: number;
  }> = {},
) {
  return {
    status: overrides.status ?? 200,
    body: overrides.body ?? JSON.stringify({ user: { id: 1, name: "John" }, items: [1, 2, 3] }),
    headers: overrides.headers ?? { "content-type": "application/json" },
    durationMs: overrides.durationMs ?? 150,
  };
}

const ctxOk: UnifiedEvalContext = {
  status: 200,
  body: JSON.stringify({ user: { id: 1, name: "John" }, items: [1, 2, 3] }),
  headers: { "content-type": "application/json" },
  durationMs: 150,
};

const ctxUser: UnifiedEvalContext = {
  status: 200,
  body: JSON.stringify({ user: { id: 123, name: "John" } }),
  headers: { "content-type": "application/json" },
  durationMs: 150,
};

// ── Tokenizer & value parsing ─────────────────────────────

describe("tokenize", () => {
  it("parses == expressions", () => {
    expect(tokenize("status == 200")).toEqual({ field: "status", operator: "==", expected: "200" });
  });

  it("parses != expressions", () => {
    expect(tokenize("status != 404")).toEqual({ field: "status", operator: "!=", expected: "404" });
  });

  it("parses contains expressions", () => {
    expect(tokenize("headers.content-type contains 'json'")).toEqual({
      field: "headers.content-type",
      operator: "contains",
      expected: "'json'",
    });
  });

  it("parses >= and <=", () => {
    expect(tokenize("duration >= 100")).toEqual({
      field: "duration",
      operator: ">=",
      expected: "100",
    });
    expect(tokenize("duration <= 500")).toEqual({
      field: "duration",
      operator: "<=",
      expected: "500",
    });
  });

  it("returns null on invalid format", () => {
    expect(tokenize("just text")).toBeNull();
    expect(tokenize("")).toBeNull();
  });
});

describe("parseExpectedValue", () => {
  it("parses numbers", () => {
    expect(parseExpectedValue("42")).toBe(42);
    expect(parseExpectedValue("-1.5")).toBe(-1.5);
  });

  it("parses quoted strings", () => {
    expect(parseExpectedValue("'hello'")).toBe("hello");
    expect(parseExpectedValue('"world"')).toBe("world");
  });

  it("parses null/undefined", () => {
    expect(parseExpectedValue("null")).toBeNull();
    expect(parseExpectedValue("undefined")).toBeNull();
  });

  it("returns raw text otherwise", () => {
    expect(parseExpectedValue("hello")).toBe("hello");
  });
});

describe("resolveVars", () => {
  it("interpolates variables from the map", () => {
    expect(resolveVars("status == {{code}}", new Map([["code", "200"]]))).toBe("status == 200");
  });

  it("leaves expression untouched when no vars map", () => {
    expect(resolveVars("status == {{code}}")).toBe("status == {{code}}");
  });

  it("keeps placeholder when variable is missing", () => {
    expect(resolveVars("status == {{missing}}", new Map())).toBe("status == {{missing}}");
  });
});

// ── Field resolution ──────────────────────────────────────

describe("resolveField", () => {
  it("resolves status", () => {
    expect(resolveField("status", makeContext({ status: 201 }))).toBe(201);
  });

  it("resolves duration", () => {
    expect(resolveField("duration", makeContext({ durationMs: 250 }))).toBe(250);
  });

  it("resolves body paths", () => {
    expect(resolveField("body.user.id", makeContext())).toBe(1);
    expect(resolveField("body.items[0]", makeContext())).toBe(1);
  });

  it("resolves headers case-insensitively", () => {
    expect(resolveField("headers.Content-Type", makeContext())).toBe("application/json");
  });

  it("returns undefined for unknown fields", () => {
    expect(resolveField("unknown", makeContext())).toBeUndefined();
  });
});

// ── Comparison ─────────────────────────────────────────────

describe("compareValues", () => {
  it("compares with == loosely via String()", () => {
    expect(compareValues(200, "==", 200)).toBe(true);
    expect(compareValues("200", "==", 200)).toBe(true);
  });

  it("compares != correctly", () => {
    expect(compareValues(404, "!=", 200)).toBe(true);
  });

  it("supports numeric comparisons", () => {
    expect(compareValues(150, "<", 200)).toBe(true);
    expect(compareValues(200, ">=", 200)).toBe(true);
  });

  it("supports contains on strings", () => {
    expect(compareValues("application/json", "contains", "json")).toBe(true);
  });

  it("supports contains on arrays", () => {
    expect(compareValues([1, 2, 3], "contains", 2)).toBe(true);
    expect(compareValues([1, 2, 3], "contains", 5)).toBe(false);
  });

  it("returns false for invalid numeric comparisons", () => {
    expect(compareValues("abc", ">", 1)).toBe(false);
  });
});

// ── Text-format evaluation (recli) ────────────────────────

describe("evaluateTextAssertion", () => {
  it("passes on status == 200", () => {
    const result = evaluateTextAssertion({ expr: "status == 200" }, makeContext());
    expect(result.passed).toBe(true);
  });

  it("fails on status == 200 when actual is 404", () => {
    const result = evaluateTextAssertion({ expr: "status == 200" }, makeContext({ status: 404 }));
    expect(result.passed).toBe(false);
    expect(result.expected).toBe("200");
    expect(result.actual).toBe("404");
  });

  it("supports body paths with bracket notation", () => {
    expect(evaluateTextAssertion({ expr: "body.items[0] == 1" }, makeContext()).passed).toBe(true);
  });

  it("supports duration comparisons", () => {
    expect(
      evaluateTextAssertion({ expr: "duration < 1000" }, makeContext({ durationMs: 150 })).passed,
    ).toBe(true);
  });

  it("uses the assertion name when provided", () => {
    const result = evaluateTextAssertion(
      { name: "Status check", expr: "status == 200" },
      makeContext(),
    );
    expect(result.name).toBe("Status check");
  });

  it("falls back to expr when no name", () => {
    const result = evaluateTextAssertion({ expr: "status == 200" }, makeContext());
    expect(result.name).toBe("status == 200");
  });

  it("interpolates vars", () => {
    const result = evaluateTextAssertion({ expr: "body.user.id == {{expected}}" }, makeContext(), {
      vars: new Map([["expected", "1"]]),
    });
    expect(result.passed).toBe(true);
  });

  it("returns failure with helpful error on invalid expression", () => {
    const result = evaluateTextAssertion({ expr: "garbage" }, makeContext());
    expect(result.passed).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe("evaluateTextAssertions (batch)", () => {
  it("evaluates multiple assertions", () => {
    const results = evaluateTextAssertions(
      [{ expr: "status == 200" }, { expr: "body.user.id == 1" }, { expr: "duration < 1000" }],
      makeContext(),
    );
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.passed)).toBe(true);
  });

  it("handles JSON Schema in batch via schema property", () => {
    const schema = { type: "object", properties: { user: { type: "object" } } };
    const results = evaluateTextAssertions([{ schema }], makeContext());
    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(true);
  });
});

// ── JSON Schema evaluation ────────────────────────────────

describe("evaluateSchemaAssertion", () => {
  it("passes when body matches schema", () => {
    const result = evaluateSchemaAssertion(
      { type: "object", properties: { id: { type: "number" } } },
      JSON.stringify({ id: 1 }),
    );
    expect(result.passed).toBe(true);
  });

  it("fails when body does not match schema", () => {
    const result = evaluateSchemaAssertion(
      { type: "object", required: ["missing"] },
      JSON.stringify({ id: 1 }),
    );
    expect(result.passed).toBe(false);
    expect(result.error).toContain("missing");
  });

  it("handles invalid JSON body", () => {
    const result = evaluateSchemaAssertion({ type: "object" }, "not json");
    expect(result.passed).toBe(false);
    expect(result.error).toContain("not valid JSON");
  });
});

describe("validateSchema", () => {
  it("validates primitives", () => {
    expect(validateSchema({ type: "string" }, "hello")).toEqual([]);
    expect(validateSchema({ type: "number", minimum: 0 }, -1)).toHaveLength(1);
  });

  it("validates required keys", () => {
    expect(validateSchema({ required: ["id"] }, { id: 1 })).toEqual([]);
    expect(validateSchema({ required: ["id"] }, {})).toHaveLength(1);
  });

  it("handles nullable", () => {
    expect(validateSchema({ type: "string", nullable: true }, null)).toEqual([]);
  });

  it("handles pattern", () => {
    expect(validateSchema({ type: "string", pattern: "^foo$" }, "foo")).toEqual([]);
    expect(validateSchema({ type: "string", pattern: "^foo$" }, "bar")).toHaveLength(1);
  });

  it("handles enum", () => {
    expect(validateSchema({ enum: ["a", "b"] }, "a")).toEqual([]);
    expect(validateSchema({ enum: ["a", "b"] }, "c")).toHaveLength(1);
  });

  it("handles oneOf", () => {
    expect(validateSchema({ oneOf: [{ type: "string" }, { type: "number" }] }, "x")).toEqual([]);
    expect(validateSchema({ oneOf: [{ type: "string" }, { type: "string" }] }, "x")).toHaveLength(
      1,
    );
  });
});

// ── Structured operators (comprehensive coverage) ────────

describe("structured operators", () => {
  // neq
  it("neq fails when equal (status-code)", () => {
    const result = evaluateStructuredAssertion(
      { name: "t", type: "status-code", operator: "neq", value: "200" },
      ctxOk,
    );
    expect(result.passed).toBe(false);
  });
  it("neq passes when not equal (status-code)", () => {
    const result = evaluateStructuredAssertion(
      { name: "t", type: "status-code", operator: "neq", value: "404" },
      ctxOk,
    );
    expect(result.passed).toBe(true);
  });
  it("neq passes when not equal (json-path)", () => {
    const result = evaluateStructuredAssertion(
      { name: "t", type: "json-path", target: "user.id", operator: "neq", value: "999" },
      ctxUser,
    );
    expect(result.passed).toBe(true);
  });
  it("neq fails when equal (header)", () => {
    const result = evaluateStructuredAssertion(
      {
        name: "t",
        type: "header",
        target: "content-type",
        operator: "neq",
        value: "application/json",
      },
      ctxOk,
    );
    expect(result.passed).toBe(false);
  });

  // gt / gte / lt / lte for status-code
  it("gt passes when status > expected", () => {
    const result = evaluateStructuredAssertion(
      { name: "t", type: "status-code", operator: "gt", value: "199" },
      ctxOk,
    );
    expect(result.passed).toBe(true);
  });
  it("gt fails when status <= expected", () => {
    const result = evaluateStructuredAssertion(
      { name: "t", type: "status-code", operator: "gt", value: "200" },
      ctxOk,
    );
    expect(result.passed).toBe(false);
  });
  it("gte passes when status >= expected", () => {
    const result = evaluateStructuredAssertion(
      { name: "t", type: "status-code", operator: "gte", value: "200" },
      ctxOk,
    );
    expect(result.passed).toBe(true);
  });
  it("lte passes when status <= expected", () => {
    const result = evaluateStructuredAssertion(
      { name: "t", type: "status-code", operator: "lte", value: "200" },
      ctxOk,
    );
    expect(result.passed).toBe(true);
  });

  // gt / gte / lt / lte for response-time
  it("lt passes when response time < expected", () => {
    const result = evaluateStructuredAssertion(
      { name: "t", type: "response-time", operator: "lt", value: "1000" },
      ctxOk,
    );
    expect(result.passed).toBe(true);
  });

  // notExists
  it("notExists passes when json-path not found", () => {
    const result = evaluateStructuredAssertion(
      { name: "t", type: "json-path", target: "nonexistent.field", operator: "notExists" },
      ctxUser,
    );
    expect(result.passed).toBe(true);
  });
  it("notExists fails when json-path exists", () => {
    const result = evaluateStructuredAssertion(
      { name: "t", type: "json-path", target: "user.id", operator: "notExists" },
      ctxUser,
    );
    expect(result.passed).toBe(false);
  });
  it("notExists passes when header not found", () => {
    const result = evaluateStructuredAssertion(
      { name: "t", type: "header", target: "x-unknown", operator: "notExists" },
      ctxOk,
    );
    expect(result.passed).toBe(true);
  });

  // regex
  it("regex passes when json-path matches pattern", () => {
    const result = evaluateStructuredAssertion(
      { name: "t", type: "json-path", target: "user.name", operator: "regex", value: "^J.*" },
      ctxUser,
    );
    expect(result.passed).toBe(true);
  });
  it("regex fails when json-path does not match", () => {
    const result = evaluateStructuredAssertion(
      { name: "t", type: "json-path", target: "user.name", operator: "regex", value: "^X.*" },
      ctxUser,
    );
    expect(result.passed).toBe(false);
  });
  it("regex passes when header matches pattern", () => {
    const result = evaluateStructuredAssertion(
      { name: "t", type: "header", target: "content-type", operator: "regex", value: "json" },
      ctxOk,
    );
    expect(result.passed).toBe(true);
  });
});

// ── Structured evaluation (reqy-mcp) ──────────────────────

describe("evaluateStructuredAssertion", () => {
  it("evaluates status-code assertions", () => {
    const result = evaluateStructuredAssertion(
      { type: "status-code", value: "200" },
      makeContext(),
    );
    expect(result.passed).toBe(true);
  });

  it("evaluates response-time assertions", () => {
    const result = evaluateStructuredAssertion(
      { type: "response-time", operator: "lt", value: "1000" },
      makeContext({ durationMs: 150 }),
    );
    expect(result.passed).toBe(true);
  });

  it("evaluates json-path assertions (eq)", () => {
    const result = evaluateStructuredAssertion(
      { type: "json-path", target: "user.id", operator: "eq", value: "1" },
      makeContext(),
    );
    expect(result.passed).toBe(true);
  });

  it("evaluates json-path assertions (exists)", () => {
    const result = evaluateStructuredAssertion(
      { type: "json-path", target: "user.id", operator: "exists" },
      makeContext(),
    );
    expect(result.passed).toBe(true);
  });

  it("evaluates json-path assertions (contains)", () => {
    const result = evaluateStructuredAssertion(
      { type: "json-path", target: "user.name", operator: "contains", value: "Jo" },
      makeContext(),
    );
    expect(result.passed).toBe(true);
  });

  it("evaluates header assertions", () => {
    const result = evaluateStructuredAssertion(
      { type: "header", target: "content-type", operator: "exists" },
      makeContext(),
    );
    expect(result.passed).toBe(true);
  });

  it("evaluates body-contains assertions", () => {
    const result = evaluateStructuredAssertion(
      { type: "body-contains", target: "John" },
      makeContext(),
    );
    expect(result.passed).toBe(true);
  });

  it("returns failure for unknown assertion type", () => {
    const result = evaluateStructuredAssertion(
      { type: "unknown" as Assertion["type"] },
      makeContext(),
    );
    expect(result.passed).toBe(false);
    expect(result.error).toContain("Unknown assertion type");
  });

  it("status-code supports { in: number[] } syntax", () => {
    const result = evaluateStructuredAssertion(
      structuredAssertion({ value: { in: [200, 201, 204] } }),
      makeContext({ status: 200 }),
    );
    expect(result.passed).toBe(true);
    expect(result.actualValue).toBe(200);
  });

  it("status-code { in: number[] } fails when status not in list", () => {
    const result = evaluateStructuredAssertion(
      structuredAssertion({ value: { in: [201, 204] } }),
      makeContext({ status: 200 }),
    );
    expect(result.passed).toBe(false);
    expect(result.actualValue).toBe(200);
  });

  it("status-code supports { not: number } syntax", () => {
    const result = evaluateStructuredAssertion(
      structuredAssertion({ value: { not: 404 } }),
      makeContext({ status: 200 }),
    );
    expect(result.passed).toBe(true);
    expect(result.actualValue).toBe(200);
  });

  it("status-code { not: number } fails when status matches", () => {
    const result = evaluateStructuredAssertion(
      structuredAssertion({ value: { not: 200 } }),
      makeContext({ status: 200 }),
    );
    expect(result.passed).toBe(false);
    expect(result.actualValue).toBe(200);
  });

  it("response-time type alias works identically to response-time", () => {
    const result = evaluateStructuredAssertion(
      { type: "response-time", operator: "lt", value: "1000" },
      makeContext({ durationMs: 150 }),
    );
    expect(result.passed).toBe(true);
  });
});

describe("evaluateStructuredAssertions (batch)", () => {
  it("filters out disabled assertions", () => {
    const results = evaluateStructuredAssertions(
      [
        { type: "status-code", value: "200" },
        { type: "status-code", value: "404", enabled: false },
      ],
      makeContext(),
    );
    expect(results).toHaveLength(1);
  });

  it("returns multiple results when all enabled", () => {
    const results = evaluateStructuredAssertions(
      [
        { type: "status-code", value: "200" },
        { type: "response-time", operator: "lt", value: "1000" },
      ],
      makeContext(),
    );
    expect(results).toHaveLength(2);
  });
});

// ── Unified dispatch ──────────────────────────────────────

describe("evaluateAssertion (unified)", () => {
  it("dispatches text format when expr is set", () => {
    expect(evaluateAssertion({ expr: "status == 200" }, makeContext()).passed).toBe(true);
  });

  it("dispatches structured format when type is set", () => {
    expect(evaluateAssertion({ type: "status-code", value: "200" }, makeContext()).passed).toBe(
      true,
    );
  });

  it("dispatches JSON Schema when schema is set", () => {
    expect(evaluateAssertion({ schema: { type: "object" } }, makeContext()).passed).toBe(true);
  });

  it("returns failure for empty assertions", () => {
    const result = evaluateAssertion({}, makeContext());
    expect(result.passed).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe("evaluateAssertions (unified batch)", () => {
  it("evaluates mixed formats", () => {
    const results = evaluateAssertions(
      [{ expr: "status == 200" }, { type: "response-time", operator: "lt", value: "1000" }],
      makeContext(),
    );
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.passed)).toBe(true);
  });
});

describe("assertsPassed", () => {
  it("returns true when all pass", () => {
    expect(assertsPassed([{ passed: true }, { passed: true }])).toBe(true);
  });
  it("returns false when any fails", () => {
    expect(assertsPassed([{ passed: true }, { passed: false }])).toBe(false);
  });
});

// ── Adapter ───────────────────────────────────────────────

describe("runResultToContext", () => {
  it("adapts a RunResult into a UnifiedEvalContext", () => {
    const ctx = runResultToContext({
      status: 201,
      durationMs: 50,
      body: "ok",
      responseHeaders: { "x-test": "1" },
    });
    expect(ctx.status).toBe(201);
    expect(ctx.durationMs).toBe(50);
    expect(ctx.body).toBe("ok");
    expect(ctx.headers).toEqual({ "x-test": "1" });
  });

  it("falls back to headers when responseHeaders is missing", () => {
    const ctx = runResultToContext({
      status: 200,
      durationMs: 1,
      headers: { fallback: "yes" },
    });
    expect(ctx.headers).toEqual({ fallback: "yes" });
  });
});

// ── User-friendly shorthand (strings / Newman-style) ───────

describe("user-friendly assertion shapes", () => {
  const ctx = makeContext({ status: 200 });

  it("evaluates a bare string as a text expression", () => {
    const res = evaluateAssertions(["status == 200", "status == 404"], ctx);
    expect(res[0].passed).toBe(true);
    expect(res[1].passed).toBe(false);
  });

  it("supports Newman-style { type: status, expect } shorthand", () => {
    const res = evaluateAssertion({ type: "status", expect: 200 }, ctx);
    expect(res.passed).toBe(true);
    const fail = evaluateAssertion({ type: "status", expect: 201 }, ctx);
    expect(fail.passed).toBe(false);
  });

  it("supports statusCode / status-code aliases with operators", () => {
    const ok = evaluateAssertion({ type: "statusCode", value: 200, operator: "eq" }, ctx);
    expect(ok.passed).toBe(true);
    const gt = evaluateAssertion({ type: "status-code", value: 199, operator: "gt" }, ctx);
    expect(gt.passed).toBe(true);
    const neq = evaluateAssertion({ type: "statusCode", expect: 404, operator: "neq" }, ctx);
    expect(neq.passed).toBe(true);
  });

  it("supports responseTime shorthand", () => {
    const ctx150 = makeContext({ durationMs: 150 });
    const ok = evaluateAssertion({ type: "responseTime", value: 500 }, ctx150);
    expect(ok.passed).toBe(true);
    const fail = evaluateAssertion({ type: "response-time", expect: 100 }, ctx150);
    expect(fail.passed).toBe(false);
  });

  it("keeps object-valued status expectations for the structured evaluator", () => {
    const res = evaluateAssertion(
      structuredAssertion({ type: "status-code", value: { in: [200, 201] } }),
      ctx,
    );
    expect(res.passed).toBe(true);
  });

  it("gives a helpful error for unusable input", () => {
    const res = evaluateAssertion("" as unknown, ctx);
    expect(res.passed).toBe(false);
    expect(res.error).toContain("text expression");
  });
});

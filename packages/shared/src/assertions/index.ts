/**
 * Unified assertion engine.
 *
 * Supports two input formats:
 * - Text format (recli): `assertion.expr` like `status == 200`
 * - Structured format (reqy-mcp): `assertion.type` + `target` + `operator` + `value`
 *
 * Also supports JSON Schema validation via `assertion.schema`.
 *
 * The unified API exposes both evaluation styles so existing callers can
 * migrate incrementally without breaking their call sites.
 */

import type { Assertion, AssertionResult } from "../types.js";
import { tokenize, parseExpectedValue, resolveVars, type ParsedToken } from "./text-parser.js";
import { validateSchema } from "./json-schema.js";
import { getValueByPath, parseResponseForExtraction } from "../variable-path/index.js";
import { resolveJsonPath, tryParseJson } from "../variable-path/index.js";

// ── Public re-exports ──────────────────────────────────────

export { tokenize, parseExpectedValue, resolveVars, type ParsedToken } from "./text-parser.js";

export { validateSchema, validateSchemaResult, type JSONSchema } from "./json-schema.js";

export {
  resolveJsonPath,
  tryParseJson,
  tokenizePath,
  getValueByPath,
} from "../variable-path/index.js";

// ── Common evaluation context ─────────────────────────────

/**
 * Unified context for assertion evaluation. Callers (recli/reqy-mcp/reqy-web)
 * can adapt their own structures to this shape.
 */
export interface UnifiedEvalContext {
  status: number;
  body?: string;
  headers?: Record<string, string>;
  durationMs: number;
}

/**
 * Convert a recli/reqy-mcp RunResult into the unified context.
 */
export function runResultToContext(result: {
  status: number;
  durationMs: number;
  body?: string;
  responseHeaders?: Record<string, string>;
  headers?: Record<string, string>;
}): UnifiedEvalContext {
  return {
    status: result.status,
    body: result.body,
    headers: result.responseHeaders ?? result.headers ?? {},
    durationMs: result.durationMs,
  };
}

// ── Field resolution (text format) ────────────────────────

/**
 * Resolve a field reference against the context. Supports:
 * - `status`, `duration`
 * - `body`, `body.<path>`, `body.<path>[<index>]`
 * - `headers.<name>`
 */
export function resolveField(field: string, ctx: UnifiedEvalContext): unknown {
  if (field === "status") return ctx.status;
  if (field === "duration") return ctx.durationMs;

  if (field.startsWith("body")) {
    const rest = field.slice(4).replace(/^\./, "");
    const body = tryParseJson(ctx.body);
    if (!rest) return body;
    return resolveJsonPath(body, rest);
  }

  if (field.startsWith("headers")) {
    const headerKey = field.slice(7).replace(/^\./, "").toLowerCase().replace(/-/g, "");
    if (!ctx.headers) return undefined;
    for (const [key, value] of Object.entries(ctx.headers)) {
      if (key.toLowerCase().replace(/-/g, "") === headerKey) {
        return value;
      }
    }
    return undefined;
  }

  return undefined;
}

// ── Comparison helpers ─────────────────────────────────────

/**
 * Compare two values with a given operator. Numeric operators coerce both
 * sides via Number(); the equality operators use String() comparison so that
 * `status == "200"` matches `status == 200`.
 */
export function compareValues(
  actual: unknown,
  operator: string,
  expected: string | number | null,
): boolean {
  if (operator === "contains") {
    if (typeof actual === "string" && typeof expected === "string") {
      return actual.toLowerCase().includes(expected.toLowerCase());
    }
    if (Array.isArray(actual)) {
      return actual.some((item) => {
        if (typeof item === "object" && item !== null) {
          return Object.values(item as Record<string, unknown>).some(
            (v) => String(v) === String(expected),
          );
        }
        return String(item) === String(expected);
      });
    }
    if (typeof actual === "object" && actual !== null) {
      return Object.values(actual as Record<string, unknown>).some(
        (v) => String(v) === String(expected),
      );
    }
    return String(actual).toLowerCase().includes(String(expected).toLowerCase());
  }

  if (operator === "==") {
    if (expected === null) return actual === null || actual === undefined;
    return String(actual) === String(expected);
  }
  if (operator === "!=") {
    if (expected === null) return actual !== null && actual !== undefined;
    return String(actual) !== String(expected);
  }

  const a = Number(actual);
  const b = Number(expected);
  if (Number.isNaN(a) || Number.isNaN(b)) return false;

  switch (operator) {
    case ">":
      return a > b;
    case "<":
      return a < b;
    case ">=":
      return a >= b;
    case "<=":
      return a <= b;
    default:
      return false;
  }
}

// ── Text-format evaluation (recli style) ──────────────────

export interface TextEvaluateOptions {
  /** Optional vars map used to interpolate {{var}} in expressions */
  vars?: Map<string, string>;
}

/**
 * ReDoS-safe regex test: caps pattern length and catches malformed patterns
 * so a hostile assertion cannot crash the runner or burn the event loop.
 */
function testPatternSafe(pattern: string, value: string): boolean {
  if (pattern.length > 200) return false;
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return false;
  }
}

/**
 * Evaluate a compound text expression supporting `||` and `&&` (with `&&`
 * binding tighter than `||`), e.g. `status == 400 || status == 422`.
 */
function evaluateCompoundText(
  expr: string,
  ctx: UnifiedEvalContext,
  options: TextEvaluateOptions,
): boolean {
  const orParts = expr.split(/\s+\|\|\s+/);
  return orParts.some((orPart) => {
    const andParts = orPart.split(/\s+&&\s+/);
    return andParts.every((andPart) => {
      const tokens = tokenize(andPart);
      if (!tokens) return false;
      const actual = resolveField(tokens.field, ctx);
      const expected = parseExpectedValue(tokens.expected);
      return compareValues(actual, tokens.operator, expected);
    });
  });
}

/**
 * Evaluate a single text-format assertion (recli style).
 *
 * @param assertion should have `expr` set, optionally `name` and `schema`.
 * @param ctx the unified evaluation context.
 * @param options optional variable map for `{{var}}` interpolation.
 */
export function evaluateTextAssertion(
  assertion: Assertion,
  ctx: UnifiedEvalContext,
  options: TextEvaluateOptions = {},
): AssertionResult {
  const expr = assertion.expr || "";
  const name = assertion.name || expr;
  const resolvedExpr = resolveVars(expr, options.vars);

  // Compound expressions: "A || B" / "A && B".
  if (/\s+(\|\||&&)\s+/.test(resolvedExpr)) {
    const passed = evaluateCompoundText(resolvedExpr, ctx, options);
    return {
      name,
      passed,
      rawExpr: expr,
      expected: resolvedExpr,
      actual: passed ? "true" : "false",
    };
  }

  const tokens: ParsedToken | null = tokenize(resolvedExpr);
  if (!tokens) {
    return {
      name,
      passed: false,
      rawExpr: expr,
      expected: "",
      actual: "",
      error: `Invalid assertion expression: "${expr}". Use format: field operator value (e.g. status == 200)`,
    };
  }

  const actual = resolveField(tokens.field, ctx);
  const expected = parseExpectedValue(tokens.expected);
  const passed = compareValues(actual, tokens.operator, expected);

  return {
    name,
    passed,
    rawExpr: expr,
    expected: typeof expected === "string" ? expected : String(expected),
    actual: actual !== undefined ? String(actual) : "undefined",
  };
}

/**
 * Evaluate a list of text-format assertions.
 */
export function evaluateTextAssertions(
  assertions: Assertion[],
  ctx: UnifiedEvalContext,
  options: TextEvaluateOptions = {},
): AssertionResult[] {
  return assertions.map((a) => {
    if (a.schema) return evaluateSchemaAssertion(a.schema, ctx.body);
    return evaluateTextAssertion(a, ctx, options);
  });
}

// ── JSON Schema evaluation ─────────────────────────────────

/**
 * Evaluate a JSON Schema assertion against a body string.
 */
export function evaluateSchemaAssertion(
  rawSchema: Record<string, unknown>,
  body: string | undefined,
): AssertionResult {
  const data = tryParseJson(body);
  if (typeof data === "string" || data === null) {
    return {
      name: "JSON Schema",
      passed: false,
      expected: JSON.stringify(rawSchema),
      actual: String(body),
      error: "Response is not valid JSON",
    };
  }
  const errors = validateSchema(rawSchema, data, "$");
  if (errors.length === 0) {
    return {
      name: "JSON Schema",
      passed: true,
      expected: "valid schema",
      actual: "valid",
    };
  }
  return {
    name: "JSON Schema",
    passed: false,
    expected: "valid schema",
    actual: errors.join("; "),
    error: errors.join(", "),
  };
}

// ── Structured evaluation (reqy-mcp style) ─────────────────

export type StructuredAssertionType =
  "status-code" | "response-time" | "json-path" | "header" | "body-contains";

export type StructuredAssertionOperator =
  "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "regex" | "exists" | "notExists";

/**
 * Internal comparator for numeric assertions.
 */
function compareNumeric(actual: number, expected: number, operator: string): boolean {
  switch (operator) {
    case "eq":
      return actual === expected;
    case "neq":
      return actual !== expected;
    case "gt":
      return actual > expected;
    case "gte":
      return actual >= expected;
    case "lt":
      return actual < expected;
    case "lte":
      return actual <= expected;
    default:
      return false;
  }
}

/**
 * Try to parse `value` as JSON; fall back to the raw string.
 */
function parseStructuredExpected(value?: string): unknown {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a === "object") return JSON.stringify(a) === JSON.stringify(b);
  return false;
}

/**
 * Evaluate a structured assertion (reqy-mcp style).
 */
export function evaluateStructuredAssertion(
  assertion: Assertion,
  ctx: UnifiedEvalContext,
): AssertionResult {
  const type = assertion.type as StructuredAssertionType | undefined;

  try {
    switch (type) {
      case "status-code": {
        const raw = assertion.value ?? assertion.target;
        let passed = false;
        let expected: unknown = raw;

        // Support { in: [...] } and { not: number } syntax
        if (typeof raw === "object" && raw !== null) {
          const obj = raw as Record<string, unknown>;
          if ("in" in obj && Array.isArray(obj.in)) {
            passed = obj.in.includes(ctx.status);
            expected = obj.in;
          } else if ("not" in obj) {
            passed = ctx.status !== Number(obj.not);
            expected = obj.not;
          }
        } else {
          const expectedNum = Number(raw);
          if (Number.isNaN(expectedNum)) {
            return {
              assertion,
              passed: false,
              actualValue: ctx.status,
              error: `Invalid expected status: ${raw}`,
            };
          }
          const op = (assertion.operator ?? "eq") as StructuredAssertionOperator;
          passed = compareNumeric(ctx.status, expectedNum, op);
        }
        return { assertion, passed, actualValue: ctx.status };
      }

      case "response-time": {
        const expected = Number(assertion.value ?? assertion.target);
        if (Number.isNaN(expected)) {
          return {
            assertion,
            passed: false,
            actualValue: ctx.durationMs,
            error: `Invalid expected response time: ${assertion.value ?? assertion.target}`,
          };
        }
        const op = (assertion.operator ?? "lt") as StructuredAssertionOperator;
        const passed = compareNumeric(ctx.durationMs, expected, op);
        return { assertion, passed, actualValue: ctx.durationMs };
      }

      case "json-path": {
        if (!ctx.body) {
          return {
            assertion,
            passed: false,
            actualValue: null,
            error: "No response body",
          };
        }
        const { parsed, isJson } = parseResponseForExtraction(ctx.body);
        if (!isJson) {
          return {
            assertion,
            passed: false,
            actualValue: null,
            error: "Response body is not JSON",
          };
        }
        const extraction = getValueByPath(parsed, assertion.target ?? "");
        const op = (assertion.operator ?? "exists") as StructuredAssertionOperator;

        if (!extraction.success) {
          return {
            assertion,
            passed: op === "notExists",
            actualValue: null,
            error: extraction.error,
          };
        }

        const actual = extraction.value;
        let passed = false;
        switch (op) {
          case "eq":
            passed = deepEqual(actual, parseStructuredExpected(assertion.value));
            break;
          case "neq":
            passed = !deepEqual(actual, parseStructuredExpected(assertion.value));
            break;
          case "contains":
            passed =
              typeof actual === "string" &&
              typeof assertion.value === "string" &&
              actual.toLowerCase().includes(assertion.value.toLowerCase());
            break;
          case "exists":
            passed = actual !== undefined && actual !== null;
            break;
          case "notExists":
            passed = actual === undefined || actual === null;
            break;
          case "gt":
          case "gte":
          case "lt":
          case "lte":
            passed = compareNumeric(Number(actual), Number(assertion.value), op);
            break;
          case "regex":
            passed =
              typeof actual === "string" &&
              typeof assertion.value === "string" &&
              testPatternSafe(assertion.value, actual);
            break;
          default:
            return {
              assertion,
              passed: false,
              actualValue: actual,
              error: `Unsupported operator: ${op}`,
            };
        }
        return { assertion, passed, actualValue: actual };
      }

      case "header": {
        const headerName = assertion.target ?? "";
        const actual = Object.entries(ctx.headers ?? {}).find(
          ([k]) => k.toLowerCase() === headerName.toLowerCase(),
        )?.[1];
        const op = (assertion.operator ?? "exists") as StructuredAssertionOperator;

        if (actual === undefined) {
          return {
            assertion,
            passed: op === "notExists",
            actualValue: null,
            error: `Header not found: ${headerName}`,
          };
        }

        let passed = false;
        switch (op) {
          case "exists":
            passed = true;
            break;
          case "notExists":
            passed = false;
            break;
          case "eq":
            passed = actual === assertion.value;
            break;
          case "neq":
            passed = actual !== assertion.value;
            break;
          case "contains":
            passed =
              typeof assertion.value === "string" &&
              actual.toLowerCase().includes(assertion.value.toLowerCase());
            break;
          case "regex":
            passed =
              typeof assertion.value === "string" && testPatternSafe(assertion.value, actual);
            break;
          default:
            return {
              assertion,
              passed: false,
              actualValue: actual,
              error: `Unsupported operator: ${op}`,
            };
        }
        return { assertion, passed, actualValue: actual };
      }

      case "body-contains": {
        if (!ctx.body) {
          return {
            assertion,
            passed: false,
            actualValue: null,
            error: "No response body",
          };
        }
        const search = assertion.target ?? "";
        const passed = ctx.body.toLowerCase().includes(search.toLowerCase());
        return { assertion, passed, actualValue: ctx.body.slice(0, 200) };
      }

      default:
        return {
          assertion,
          passed: false,
          actualValue: null,
          error: `Unknown assertion type: ${assertion.type ?? "undefined"}`,
        };
    }
  } catch (err) {
    return {
      assertion,
      passed: false,
      actualValue: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Evaluate a list of structured assertions. Disabled assertions (`enabled === false`)
 * are filtered out, matching reqy-mcp behaviour.
 */
export function evaluateStructuredAssertions(
  assertions: Assertion[],
  ctx: UnifiedEvalContext,
): AssertionResult[] {
  return assertions
    .filter((a) => a.enabled !== false)
    .map((assertion) => evaluateStructuredAssertion(assertion, ctx));
}

// ── Unified dispatch ───────────────────────────────────────

/**
 * Coerce user-friendly assertion shapes into a dispatchable Assertion:
 *   - a bare string -> `{ expr: string }` (text format)
 *   - Newman-style `{ type: "status" | "statusCode" | "status-code", expect | value, operator? }`
 *     -> `{ expr: "status <op> value" }`
 *   - Newman-style `{ type: "responseTime" | "response-time", expect | value, operator? }`
 *     -> `{ expr: "duration <op> value" }`
 * Anything else is returned unchanged (text `expr`, structured `type`, `schema`).
 * Object-valued status expectations (`{ in: [...] }`, `{ not: n }`) are left
 * for the structured evaluator, not mangled into a text expression.
 */
export function normalizeAssertion(input: unknown): Assertion {
  if (typeof input === "string") return { expr: input };
  if (input === null || typeof input !== "object" || Array.isArray(input)) return {};
  const a = input as Record<string, unknown>;
  const type = typeof a.type === "string" ? a.type : undefined;
  const value = a.expect ?? a.value;
  const isScalar = typeof value === "number" || typeof value === "string";
  const OP_SYMS: Record<string, string> = {
    eq: "==",
    neq: "!=",
    gt: ">",
    gte: ">=",
    lt: "<",
    lte: "<=",
  };
  // Only comparison operators are rewritten to text. An unknown operator (e.g.
  // "regex" on a status) is left to the structured evaluator, which reports it
  // as failing rather than silently changing it into an equality check.
  const opRaw = a.operator === undefined ? undefined : String(a.operator);
  const sym = opRaw === undefined ? undefined : OP_SYMS[opRaw];
  if (isScalar && (type === "status" || type === "statusCode" || type === "status-code")) {
    if (opRaw !== undefined && sym === undefined) return input as Assertion;
    return { expr: `status ${sym ?? "=="} ${value}` };
  }
  if (isScalar && (type === "responseTime" || type === "response-time")) {
    if (opRaw !== undefined && sym === undefined) return input as Assertion;
    return { expr: `duration ${sym ?? "<"} ${value}` };
  }
  return input as Assertion;
}

/**
 * Auto-detect the format of an assertion and dispatch to the appropriate
 * evaluator. Accepts strings and Newman-style shorthand via normalizeAssertion.
 * Text format takes precedence when `expr` is present.
 */
export function evaluateAssertion(
  input: unknown,
  ctx: UnifiedEvalContext,
  options: TextEvaluateOptions = {},
): AssertionResult {
  const assertion = normalizeAssertion(input);
  if (assertion.expr) {
    if (assertion.schema) {
      return evaluateSchemaAssertion(assertion.schema, ctx.body);
    }
    return evaluateTextAssertion(assertion, ctx, options);
  }
  if (assertion.type) {
    return evaluateStructuredAssertion(assertion, ctx);
  }
  if (assertion.schema) {
    return evaluateSchemaAssertion(assertion.schema, ctx.body);
  }
  return {
    name: assertion.name,
    passed: false,
    error:
      `Unsupported assertion: expected a text expression (a string or { expr })` +
      `, a structured { type }, or a { schema }` +
      `${typeof input === "string" ? ` — got: "${input}"` : ""}`,
  };
}

/**
 * Evaluate a list of assertions of any supported format. Entries may be
 * strings or Newman-style shorthand — normalizeAssertion coerces them.
 */
export function evaluateAssertions(
  assertions: unknown[],
  ctx: UnifiedEvalContext,
  options: TextEvaluateOptions = {},
): AssertionResult[] {
  return assertions.map((a) => evaluateAssertion(a, ctx, options));
}

/**
 * Returns true iff every assertion in the list passed.
 */
export function assertsPassed(assertions: AssertionResult[]): boolean {
  return assertions.every((a) => a.passed);
}

// ── Legacy aliases for backward compatibility ──────────────

/**
 * @deprecated Use evaluateTextAssertion. Alias kept for recli migration.
 */
export const evaluateAssertionLegacy = evaluateTextAssertion;

/**
 * @deprecated Use evaluateTextAssertions. Alias kept for recli migration.
 */
export const evaluateAssertionsLegacy = evaluateTextAssertions;

/**
 * Phase 6.4 — Test suggestions prompt builder
 *
 * Generates a structured prompt asking the LLM to produce test assertions
 * categorized by nominal (happy path), error (4xx/5xx), and edge cases.
 */

export type TestCategory = "nominal" | "error" | "edge";

export interface TestAssertionSuggestion {
  category: TestCategory;
  label: string;
  /** JS test code using the `expect` API. */
  code: string;
}

/**
 * Context for test suggestion. Kept narrow so this module stays free of
 * the heavier AIContext type (which lives in lib/ai-engine).
 */
export interface TestSuggestionContext {
  method: string;
  url: string;
  /** Optional headers map (filtered to avoid leaking secrets). */
  headers?: Record<string, string>;
  /** Optional body shape (string or already-stringified JSON). */
  body?: string | null;
  /** Last known status code, when available. */
  lastStatus?: number;
}

const CATEGORY_INSTRUCTIONS: Record<TestCategory, string> = {
  nominal:
    "Nominal (happy path): assert the expected success status (2xx) and that key response fields are present.",
  error:
    "Error: assert behaviour for 4xx/5xx responses — at minimum one test that triggers an auth failure (401/403), one for a not-found case (404), and one for validation failure (422) when applicable.",
  edge:
    "Edge cases: boundary conditions — empty body, oversized payload (413/415), rate limiting (429), timeout behaviour.",
};

/**
 * Build the prompt asking the LLM for categorized test assertions.
 * Returns a JSON-only directive consistent with the rest of the engine.
 */
export function buildTestSuggestionsPrompt(ctx: TestSuggestionContext): string {
  const headerSummary = ctx.headers
    ? Object.keys(ctx.headers).filter((k) => !/^authorization$/i.test(k)).join(", ") || "none"
    : "none";
  const bodySummary = ctx.body ? ctx.body.slice(0, 400) : "(no body)";
  const lastStatus = ctx.lastStatus ?? "unknown";

  return `Generate JavaScript test assertions for the request:
- Method: ${ctx.method}
- URL: ${ctx.url}
- Headers (without auth): ${headerSummary}
- Body (truncated): ${bodySummary}
- Last known status: ${lastStatus}

Produce at least 6 test assertions, split across these categories:

${Object.entries(CATEGORY_INSTRUCTIONS)
  .map(([cat, desc]) => `- ${cat.toUpperCase()}: ${desc}`)
  .join("\n")}

Each assertion must include:
- "category": one of "nominal", "error", "edge"
- "label": a short human-readable description
- "code": a JavaScript snippet using the \`expect(response...)\` pattern

Return JSON only, no markdown fences. Schema:
{ "suggestions": [ { "category": "...", "label": "...", "code": "..." }, ... ] }`;
}

/**
 * Validate a parsed suggestion object (defensive — for when callers parse
 * the LLM output and want a sanity check before applying).
 */
export function isValidSuggestion(s: unknown): s is TestAssertionSuggestion {
  if (!s || typeof s !== "object") return false;
  const o = s as Record<string, unknown>;
  if (!["nominal", "error", "edge"].includes(o.category as string)) return false;
  if (typeof o.label !== "string" || o.label.length === 0) return false;
  if (typeof o.code !== "string" || o.code.length === 0) return false;
  return true;
}

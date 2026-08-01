/**
 * Text-based assertion parser (recli format).
 *
 * Supports expressions like:
 *   status == 200
 *   status != 404
 *   body.user.id == 1
 *   body.items.length > 0
 *   headers.content-type contains 'json'
 *   duration < 1000
 */

export interface ParsedToken {
  field: string;
  operator: string;
  expected: string;
}

const OPS = ["!=", ">=", "<=", "==", ">", "<"];

/**
 * Tokenize an expression like `field op value` into its parts.
 * Returns null when the expression cannot be parsed.
 */
export function tokenize(expr: string): ParsedToken | null {
  const trimmed = expr.trim();
  if (!trimmed) return null;

  const containsMatch = trimmed.match(/^(\S+)\s+contains\s+(.+)$/i);
  if (containsMatch) {
    return {
      field: containsMatch[1],
      operator: "contains",
      expected: containsMatch[2].trim(),
    };
  }

  for (const op of OPS) {
    const idx = trimmed.indexOf(op);
    if (idx === -1) continue;
    const field = trimmed.slice(0, idx).trim();
    const expected = trimmed.slice(idx + op.length).trim();
    if (field && expected) {
      return { field, operator: op, expected };
    }
  }
  return null;
}

/**
 * Parse an expected value literal: `'string'`, `"string"`, `null`, or numeric.
 */
export function parseExpectedValue(raw: string): string | number | null {
  const trimmed = raw.trim();
  if (trimmed === "null" || trimmed === "undefined") return null;
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  const num = Number(trimmed);
  if (!Number.isNaN(num) && trimmed !== "") return num;
  return trimmed;
}

/**
 * Resolve `{{var}}` interpolations in a string using a vars map, then
 * falling back to `process.env` values when available.
 */
export function resolveVars(text: string, vars?: Map<string, string>): string {
  if (!vars) return text;
  return text.replace(/\{\{([^}]+)\}\}/g, (_match, varName: string) => {
    const trimmed = varName.trim();
    const value = vars.get(trimmed);
    if (value !== undefined) return value;
    if (typeof process !== "undefined" && process.env) {
      const envValue = process.env[trimmed];
      if (envValue !== undefined) return envValue;
    }
    return `{{${trimmed}}}`;
  });
}

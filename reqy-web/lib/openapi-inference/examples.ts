/**
 * Extract a representative example value from a response body.
 *
 * For arrays we return the first element (most representative item).
 * For objects we return the object as-is (it is already an example).
 * For primitives (strings, numbers, booleans, null) we return the value directly.
 * Nested arrays / objects are recursively condensed so the result stays compact.
 */
export function extractExample(responseBody: unknown): unknown {
  return condense(responseBody, 0);
}

/** Maximum nesting depth to recurse into before collapsing to a type placeholder. */
const MAX_DEPTH = 6;

function condense(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return null;

  if (depth >= MAX_DEPTH) {
    return typeof value === "object" ? (Array.isArray(value) ? [] : {}) : value;
  }

  if (Array.isArray(value)) {
    // Use the first element as the canonical example
    const first = value[0];
    if (first === undefined) return [];
    return condense(first, depth + 1);
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const condensed: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      condensed[key] = condense(val, depth + 1);
    }
    return condensed;
  }

  // Primitive: string, number, boolean
  return value;
}

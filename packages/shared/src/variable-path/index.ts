/**
 * Unified JSONPath utilities.
 *
 * Provides both API styles previously found across packages:
 * - `resolveJsonPath` / `tokenizePath` / `tryParseJson` (recli style)
 * - `getValueByPath` / `PathExtractionResult` / `parseResponseForExtraction`
 *   (reqy-mcp / reqy-web style)
 *
 * Web-specific extractors (XML, regex, content-type detection) stay in
 * reqy-web since they depend on browser APIs (DOMParser, Blob).
 */

// ── recli-style API ────────────────────────────────────────

/**
 * Split a dotted/bracketed path into segments.
 *
 *   "a.b[0].c" -> ["a", "b", "0", "c"]
 *   "items[2].name" -> ["items", "2", "name"]
 */
export function tokenizePath(path: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inBracket = false;
  for (let i = 0; i < path.length; i++) {
    const c = path[i];
    if (c === "[") {
      if (current) {
        parts.push(current);
        current = "";
      }
      inBracket = true;
    } else if (c === "]") {
      if (current) {
        parts.push(current);
        current = "";
      }
      inBracket = false;
    } else if (c === "." && !inBracket) {
      if (current) {
        parts.push(current);
        current = "";
      }
    } else {
      current += c;
    }
  }
  if (current) parts.push(current);
  return parts;
}

/**
 * Resolve a path string against an object. Returns `undefined` when the
 * path cannot be resolved (intermediate value is null/undefined, or the
 * key does not exist).
 *
 *   resolveJsonPath({a: {b: [{c: 1}]}}, "a.b[0].c") === 1
 */
export function resolveJsonPath(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  const parts = tokenizePath(path);
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      if (part === "length") {
        current = current.length;
        continue;
      }
      const idx = parseInt(part, 10);
      if (!Number.isNaN(idx)) {
        current = current[idx];
        continue;
      }
      return undefined;
    }
    if (typeof current === "object") {
      // Anti-prototype-pollution : ne jamais suivre __proto__/constructor/prototype
      if (part === "__proto__" || part === "constructor" || part === "prototype") {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * Try to parse a string as JSON. Returns the original string when parsing fails.
 */
export function tryParseJson(body: string | undefined | null): unknown {
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

// ── reqy-mcp / reqy-web style API ──────────────────────────

export interface PathExtractionResult {
  success: boolean;
  value?: unknown;
  error?: string;
}

/**
 * Read a value at a dotted path. Supports `$.foo`, `foo.bar`, `items[0]`.
 * Returns a structured result so callers can distinguish a real `undefined`
 * value from a missing path.
 */
export function getValueByPath(value: unknown, path: string): PathExtractionResult {
  if (!path || typeof path !== "string" || !path.trim()) {
    return { success: true, value };
  }

  const trimmedPath = path.trim();

  // Reject invalid path formats early so callers can surface a clear
  // 'Invalid path format' error instead of a generic 'Path not found'.
  if (!isSourcePathSyntaxValid(trimmedPath)) {
    return { success: false, error: "Invalid path format" };
  }

  try {
    // Strip optional JSONPath-style $ prefix so "$.id" matches "id".
    const normalizedPath = trimmedPath.replace(/^\$\.?/, "");
    const result = normalizedPath.split(".").reduce<unknown | undefined>((current, segment) => {
      if (current === undefined || current === null) return undefined;

      const parts = segment
        .replace(/\[(\d+)\]/g, ".$1")
        .split(".")
        .filter(Boolean);

      return parts.reduce<unknown | undefined>((acc, key) => {
        if (acc === undefined || acc === null) return undefined;
        if (typeof acc !== "object") return undefined;
        return (acc as Record<string, unknown>)[key];
      }, current);
    }, value);

    if (result === undefined) {
      return { success: false, error: `Path not found: ${trimmedPath}` };
    }

    return { success: true, value: result };
  } catch (err) {
    return {
      success: false,
      error: `Extraction error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Parse a response body for value extraction. Returns the parsed value
 * alongside a flag indicating whether the original looked like JSON.
 */
export function parseResponseForExtraction(responseBody: string): {
  parsed: unknown;
  isJson: boolean;
} {
  const trimmed = responseBody.trim();
  if (!trimmed) {
    return { parsed: "", isJson: false };
  }

  try {
    return { parsed: JSON.parse(responseBody), isJson: true };
  } catch {
    return { parsed: responseBody, isJson: false };
  }
}

/**
 * Validate that a source path has valid syntax for JSON extraction.
 * Allows dotted paths (`a.b.c`), bracket notation (`items[0].id`),
 * $‑prefix (`$.user.name`), and rejects consecutive dots or empty strings.
 */
export function isSourcePathSyntaxValid(path: string): boolean {
  if (typeof path !== "string") return false;
  if (path === "") return true;
  // Reject consecutive dots
  if (path.includes("..")) return false;
  // Must start with a letter, underscore, or $
  // Remainder may include letters, digits, underscore, $, ., [, ], -
  return /^[a-zA-Z_$][a-zA-Z0-9_$.\[\]-]*$/.test(path);
}

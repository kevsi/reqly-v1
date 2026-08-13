// ── Path Variables — `:id` style parameters in URLs ─────────────────────
// Inspired by Postman: when the user types /users/:id in the URL, we detect
// it and expose a key-value editor so they can fill in the value.

export interface PathParam {
  key: string;
  value: string;
  enabled?: boolean;
}

/**
 * Regex that matches `:paramName` in URL paths.
 * The lookbehind excludes `://` (scheme separator) while `:paramName`
 * preceded by `/` or at the start of a segment is correctly captured.
 */
const PATH_PARAM_REGEX = /(?<!\w):([a-zA-Z_][a-zA-Z0-9_]*)\b/g;

/**
 * Extract all `:paramName` patterns from a URL string.
 * Returns the unique set of parameter names in order of appearance.
 * Skips colons that are part of the protocol (`https://` → no match).
 */
export function extractPathParamNames(url: string): string[] {
  const names = new Set<string>();
  const matches = url.matchAll(PATH_PARAM_REGEX);
  for (const m of matches) {
    names.add(m[1]);
  }
  return Array.from(names);
}

/**
 * Given a URL and an array of path params, replace `:paramName` with the
 * corresponding value for every enabled param. Unknown `:paramName` patterns
 * (no matching entry) are left as-is so the user can see them.
 */
export function applyPathParams(url: string, params?: PathParam[] | null): string {
  const paramMap = new Map<string, string>();
  for (const p of params ?? []) {
    if (p.enabled !== false && p.key?.trim()) {
      paramMap.set(p.key.trim(), (p.value ?? "").trim());
    }
  }
  return url.replace(PATH_PARAM_REGEX, (match, name) => {
    const replacement = paramMap.get(name);
    return replacement !== undefined ? replacement : match;
  });
}

/**
 * Merge existing path params with fresh names extracted from the URL.
 * Preserves the value of any param that already exists (by key).
 * Removes entries for params that no longer appear in the URL.
 */
export function syncPathParams(url: string, current?: PathParam[] | null): PathParam[] {
  const fresh = extractPathParamNames(url);
  const existingMap = new Map((current ?? []).map((p) => [p.key, p]));
  return fresh.map((name) => {
    const existing = existingMap.get(name);
    return existing ?? { key: name, value: "", enabled: true };
  });
}

/**
 * Phase 6.5 — Heuristic request parser
 *
 * Extracts a structured request (method, URL, headers, body) from a
 * natural language description. Pure functions, no LLM.
 *
 * Recognized patterns:
 *   "GET https://api.example.com/users"
 *   "POST to /v1/orders with header Authorization: Bearer abc"
 *   "PATCH https://x.com with body { \"name\": \"foo\" }"
 */

export interface ParsedRequest {
  method: string;
  url: string;
  headers: Array<{ key: string; value: string }>;
  body?: string;
}

const METHOD_RE = /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/i;
const URL_RE = /\bhttps?:\/\/[^\s"'<>]+/i;

const KNOWN_METHOD_KEYWORDS: Array<{ pattern: RegExp; method: string }> = [
  // PATCH must come BEFORE PUT: "partial update" should match PATCH, not PUT.
  { pattern: /\b(partial update|partial update|merge|patch)\b/i, method: "PATCH" },
  { pattern: /\b(create|insert|add|submit)\b/i, method: "POST" },
  { pattern: /\b(update|modify|change|set)\b/i, method: "PUT" },
  { pattern: /\b(delete|remove|destroy)\b/i, method: "DELETE" },
  { pattern: /\b(list|fetch|get|retrieve|read|show)\b/i, method: "GET" },
];

const HEADER_PATTERNS: Array<{ regex: RegExp; key: string }> = [
  // For Authorization: capture multi-word values (e.g. "Bearer abc def") until natural boundary.
  { regex: /\bauthorization\s*[:=]\s*([^,;]+?)(?=\s*(?:,|;|\.|$|\bwith\b|\band\b))/i, key: "Authorization" },
  { regex: /\bcontent-type\s*[:=]\s*["']?([^"'\s,;}]+)["']?/i, key: "Content-Type" },
  { regex: /\baccept\s*[:=]\s*["']?([^"'\s,;}]+)["']?/i, key: "Accept" },
  { regex: /\bx-api-key\s*[:=]\s*["']?([^"'\s,;}]+)["']?/i, key: "X-API-Key" },
  { regex: /\bbearer\s+([A-Za-z0-9\-._~+/]+=*)/i, key: "Authorization" }, // bare "bearer xxx"
];

/** Extract a JSON-like object body from a description. */
function extractBody(text: string): string | undefined {
  // Match {...} or [...] as a JSON literal, allowing nested braces.
  const objStart = text.indexOf("{");
  const arrStart = text.indexOf("[");
  const start =
    objStart === -1 ? arrStart : arrStart === -1 ? objStart : Math.min(objStart, arrStart);
  if (start === -1) return undefined;

  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let end = -1;
  for (let i = start; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close) {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return undefined;
  const candidate = text.slice(start, end + 1);
  try {
    // Parse + stringify to normalize whitespace (so output is canonical JSON).
    return JSON.stringify(JSON.parse(candidate));
  } catch {
    return undefined;
  }
}

/**
 * Parse a natural-language description into a request structure.
 * Falls back to GET if no method can be inferred.
 */
export function parseRequestDescription(description: string): ParsedRequest {
  const out: ParsedRequest = {
    method: "GET",
    url: "",
    headers: [],
  };

  // 1. Method
  const m = description.match(METHOD_RE);
  if (m) {
    out.method = m[1].toUpperCase();
  } else {
    // Heuristic fallback from action keywords
    for (const { pattern, method } of KNOWN_METHOD_KEYWORDS) {
      if (pattern.test(description)) {
        out.method = method;
        break;
      }
    }
  }

  // 2. URL
  const u = description.match(URL_RE);
  if (u) {
    out.url = u[0];
  } else {
    // Look for path-only URLs: "/v1/users" or "the /users endpoint"
    const pathOnly = description.match(/(?:^|\s|to|endpoint\s+)(\/[A-Za-z0-9._\-/:]+)/);
    if (pathOnly) {
      out.url = pathOnly[1];
    }
  }

  // 3. Headers
  for (const { regex, key } of HEADER_PATTERNS) {
    const match = description.match(regex);
    if (match) {
      const value = match[1].trim();
      if (value && key.toLowerCase() === "authorization" && !value.toLowerCase().startsWith("bearer ")) {
        out.headers.push({ key, value: `Bearer ${value}` });
      } else {
        out.headers.push({ key, value });
      }
    }
  }

  // 4. Body (if not GET/HEAD)
  if (!["GET", "HEAD"].includes(out.method)) {
    const body = extractBody(description);
    if (body) out.body = body;
  }

  return out;
}

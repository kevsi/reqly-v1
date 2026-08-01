/**
 * Extract a GraphQL operation string from a raw LLM reply.
 *
 * Models often reply with a JSON wrapper (the Reqly AI protocol demands it via
 * SYSTEM_PROMPT, even when we ask for "just the query"). The query itself can
 * land at a few different locations depending on the provider/model:
 *   - top level:            { "query": "..." }
 *   - REST-shaped body:     { "body": "..." }          (graphql query inside a REST request body)
 *   - actions wrapper:      { "actions": [{ "payload": { "body": "..." } }] }
 *   - raw GraphQL string:   query Foo { bar }
 *
 * Models also sometimes output the JSON with literal newlines inside string
 * values, which is invalid JSON. This helper tries to be lenient.
 */
export function extractGraphqlReply(raw: string): string {
  if (!raw) return ""
  let text = raw.trim()

  // 1. Strip ```graphql / ``` fences if present.
  const fence = text.match(/```(?:graphql|gql)?\s*([\s\S]*?)```/i)
  if (fence) text = fence[1].trim()

  // 2. If the model returned raw GraphQL directly, find it.
  //    Important: filter out matches that contain `"` — those are JSON wrappers
  //    (e.g. `"body": "query { ... }"`), and the regex would otherwise extend
  //    through the JSON to its closing `\n}` brace. The bodyMatch / JSON.parse
  //    paths below handle those cases correctly.
  const direct = text.match(/\b(?:query|mutation|subscription)\b[^{]*\{[\s\S]*?\n\}/)
  if (direct && direct[0].includes("{") && !direct[0].includes('"')) {
    return direct[0].trim()
  }

  // 3. Look for a "body": "..." string in the raw text (handles invalid JSON
  //    with literal newlines between tokens, which the user saw).
  //    IMPORTANT: use *? (non-greedy) — * extends the capture to the LAST "
  //    in the input (e.g. the closing brace of the JSON wrapper), which
  //    swallows the rest of the document into the body value.
  const bodyMatch = text.match(/"body"\s*:\s*"((?:\\.|[^"\\])*?)"/)
  if (bodyMatch) {
    const unescaped = bodyMatch[1]
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\")
    if (looksLikeGraphql(unescaped)) return unescaped.trim()
  }

  // 4. Try to parse the JSON. Pre-fix real newlines inside string values so
  //    the parser accepts the malformed models sometimes emit.
  const jsonStart = text.indexOf("{")
  if (jsonStart !== -1) {
    const candidate = sanitizeJsonStrings(text.slice(jsonStart))
    try {
      const parsed = JSON.parse(candidate) as unknown
      const fromObj = findGraphqlInUnknown(parsed)
      if (fromObj) return fromObj
    } catch {
      // fall through
    }
  }

  // 5. Last resort: return the trimmed raw text.
  return text
}

function looksLikeGraphql(s: string): boolean {
  if (!s) return false
  const t = s.trim()
  return (
    t.includes("{") &&
    /\b(?:query|mutation|subscription|fragment)\b/.test(t)
  )
}

function findGraphqlInUnknown(node: unknown, depth = 0): string | null {
  if (depth > 8) return null // avoid pathological recursion
  if (node == null) return null

  if (typeof node === "string") {
    return looksLikeGraphql(node) ? node.trim() : null
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findGraphqlInUnknown(item, depth + 1)
      if (found) return found
    }
    return null
  }

  if (typeof node === "object") {
    const obj = node as Record<string, unknown>
    // Priority keys first — these are the most likely locations.
    const priorityKeys = [
      "query",
      "graphql",
      "queryString",
      "queryDocument",
      "operation",
      "text",
      "content",
      "result",
      "body",
      "raw",
    ]
    for (const key of priorityKeys) {
      if (key in obj) {
        const found = findGraphqlInUnknown(obj[key], depth + 1)
        if (found) return found
      }
    }
    // Fallback: walk all keys (still bounded by depth).
    for (const key of Object.keys(obj)) {
      if (priorityKeys.includes(key)) continue
      const found = findGraphqlInUnknown(obj[key], depth + 1)
      if (found) return found
    }
  }

  return null
}

/**
 * Replace raw newlines inside JSON string values with the escaped form \n.
 * Models sometimes output strings spanning multiple lines, which is invalid
 * JSON. This makes the parser more forgiving without changing correctly
 * formatted JSON (which never has raw newlines inside quotes).
 */
function sanitizeJsonStrings(input: string): string {
  let result = ""
  let inString = false
  let escaped = false
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (escaped) {
      result += ch
      escaped = false
      continue
    }
    if (ch === "\\") {
      result += ch
      escaped = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      result += ch
      continue
    }
    if (inString && (ch === "\n" || ch === "\r")) {
      result += ch === "\n" ? "\\n" : "\\r"
      continue
    }
    result += ch
  }
  return result
}

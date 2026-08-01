export function formatGraphQL(query: string): string {
  if (!query.trim()) return ""

  const normalized = query.replace(/\r\n/g, "\n").trim()
  const tokens = normalized
    .replace(/\s+/g, " ")
    .replace(/\{/g, " { ")
    .replace(/\}/g, " } ")
    .replace(/,/g, " , ")
    .split(/\s+/)
    .filter(Boolean)

  let depth = 0
  const indent = "  "
  const out: string[] = []

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]
    if (tok === "{") {
      const last = out[out.length - 1]
      // At top level, inline the opening brace onto the previous identifier
      // line so the output reads "query Foo {" instead of stacking each
      // token on its own line. Nested `{` keeps its own line.
      if (
        last !== undefined &&
        depth === 0 &&
        last.trim() !== "" &&
        !/[{,]\s*$/.test(last)
      ) {
        out[out.length - 1] = last + " {"
      } else {
        out.push(indent.repeat(depth) + "{")
      }
      depth++
    } else if (tok === "}") {
      depth = Math.max(0, depth - 1)
      out.push(indent.repeat(depth) + "}")
      // peek: next non-space token is on same level so add blank line for readability
      const next = tokens[i + 1]
      if (next && next !== "}" && next !== ",") {
        out.push("")
      }
    } else if (tok === ",") {
      const last = out[out.length - 1]
      if (last !== undefined) out[out.length - 1] = last.replace(/,\s*$/, "") + ","
    } else {
      // Identifier / arg / value — look ahead for "(" to keep one-liners
      const next = tokens[i + 1]
      if (next === "(") {
        // Inline args block
        let inline = tok + " ("
        let j = i + 2
        let parenDepth = 1
        while (j < tokens.length && parenDepth > 0) {
          const t = tokens[j]
          if (t === "(") parenDepth++
          else if (t === ")") {
            parenDepth--
            if (parenDepth === 0) {
              inline += ")"
              break
            }
          } else if (t === ":") {
            inline += ": "
          } else {
            inline += t + " "
          }
          j++
        }
        out.push(indent.repeat(depth) + inline.trim())
        i = j
      } else {
        const line = indent.repeat(depth) + tok
        const last = out[out.length - 1]
        // At top level, merge consecutive identifiers onto the same line
        // ("query" + "Foo" -> "query Foo") so we don't break up a call
        // signature across lines.
        if (
          last !== undefined &&
          depth === 0 &&
          /^\S(.*\S)?$/.test(last) &&
          !/[{(\s]$/.test(last)
        ) {
          out[out.length - 1] = last + " " + tok
        } else {
          out.push(line)
        }
      }
    }
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim()
}

// --- Type label formatting for the Visual Builder ---

/**
 * Subset of the GraphQL introspection type ref we need. The full type wraps
 * NON_NULL / LIST around a named type via `ofType`. For [Foo!]! the chain
 * is NON_NULL → LIST → NON_NULL → NamedType (4 levels).
 */
export interface SchemaFieldType {
  kind?: string
  name?: string | null
  ofType?: SchemaFieldType | null
}

/**
 * Pretty-print a GraphQL type signature.
 *
 * Examples:
 *   { kind: "OBJECT", name: "Country" }           -> "Country"
 *   { kind: "NON_NULL", ofType: { kind: "OBJECT", name: "Country" } } -> "Country!"
 *   { kind: "LIST", ofType: { kind: "OBJECT", name: "Country" } }    -> "[Country]"
 *   { kind: "NON_NULL", ofType: { kind: "LIST", ofType: {
 *       kind: "NON_NULL", ofType: { kind: "OBJECT", name: "Country" } } } }
 *                                                 -> "[Country!]!"
 *
 * Defensive: if a NON_NULL or LIST wrapper has no `ofType` (truncated
 * introspection, very old servers), we fall back to appending "!" or "[]"
 * to the name we do have so we never emit the dreaded "Unknown!".
 */
export function typeLabel(type: SchemaFieldType | undefined | null): string {
  if (!type) return "Unknown"
  if (type.kind === "NON_NULL") {
    if (type.ofType) return `${typeLabel(type.ofType)}!`
    return (type.name ?? "Unknown") + "!"
  }
  if (type.kind === "LIST") {
    if (type.ofType) return `[${typeLabel(type.ofType)}]`
    return (type.name ?? "Unknown") + "[]"
  }
  return type.name ?? "Unknown"
}

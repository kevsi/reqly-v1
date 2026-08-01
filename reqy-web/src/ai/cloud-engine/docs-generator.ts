/**
 * Phase 6.7 — Auto documentation generator
 *
 * Builds a prompt that asks the LLM to produce a Markdown documentation
 * page for a collection of HTTP endpoints.
 */

export interface EndpointSummary {
  method: string;
  url: string;
  /** Optional short description / intent. */
  description?: string;
  /** Optional headers map (auth headers filtered out). */
  headers?: Record<string, string>;
  /** Optional body shape description. */
  bodyShape?: string | null;
  /** Optional response shape description. */
  responseShape?: string | null;
}

/**
 * Sanitize headers: keep only non-secret keys.
 */
export function safeHeaders(headers?: Record<string, string>): Record<string, string> {
  if (!headers) return {};
  const SECRET = /^(authorization|x-api-key|apikey|cookie|set-cookie|x-auth-token|x-csrf-token)$/i;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (!SECRET.test(k)) out[k] = v;
  }
  return out;
}

/**
 * Build the prompt asking the LLM to produce Markdown documentation for
 * a collection of endpoints. The response is expected to be a single
 * Markdown document.
 */
export function buildCollectionDocsPrompt(
  endpoints: EndpointSummary[],
  options: { title?: string; audience?: string } = {}
): string {
  const title = options.title ?? "API Collection";
  const audience = options.audience ?? "developers integrating with this API";

  const endpointList = endpoints
    .map((e, i) => {
      const lines: string[] = [];
      lines.push(`${i + 1}. **${e.method} ${e.url}**`);
      if (e.description) lines.push(`   - Description: ${e.description}`);
      const headers = safeHeaders(e.headers);
      if (Object.keys(headers).length > 0) {
        lines.push(`   - Headers: ${JSON.stringify(headers)}`);
      }
      if (e.bodyShape) lines.push(`   - Body: ${e.bodyShape}`);
      if (e.responseShape) lines.push(`   - Response: ${e.responseShape}`);
      return lines.join("\n");
    })
    .join("\n");

  return `Generate comprehensive Markdown documentation for the API collection titled "${title}".

Audience: ${audience}.

Endpoints:
${endpointList}

Structure the document with the following sections:
1. **Overview** — short intro to the collection (1-2 paragraphs)
2. **Authentication** — describe any common auth pattern inferred from headers
3. **Endpoints** — one subsection per endpoint, each with:
   - Purpose
   - Method + URL
   - Example request (cURL + JS fetch)
   - Example response schema
4. **Quick start** — minimal working example chaining 2-3 endpoints
5. **Error handling** — common status codes and their meaning

Use {{VARIABLE_NAME}} placeholders for env-specific values. Be concise and concrete.
Return only the Markdown document, no prose wrapper.`;
}

/**
 * Lightweight sanity check on the parsed LLM output. A doc is considered
 * valid if it contains at least one Markdown heading and one code block.
 */
export function isValidDocsOutput(markdown: string): boolean {
  if (typeof markdown !== "string" || markdown.length < 100) return false;
  if (!/^#{1,6}\s+/m.test(markdown)) return false;
  if (!/```[\s\S]+?```/.test(markdown)) return false;
  return true;
}

/**
 * Phase 6.1 — Generation module
 *
 * Extracted from `lib/ai-engine.ts` to centralize the LLM-driven request
 * generation logic. Keeps the same prompt shape so existing callers and
 * tests stay compatible.
 */

/**
 * Build the prompt that converts a natural language description into a
 * fully specified HTTP request. The LLM is expected to respond with a
 * single `FILL_REQUEST` action.
 */
export function buildNaturalLanguagePrompt(
  description: string,
  envVars: Record<string, unknown> = {}
): string {
  const envList =
    Object.entries(envVars)
      .map(([key, value]) => `- {{${key}}} = ${String(value).slice(0, 40)}`)
      .join("\n") || "none";
  return `Convert the natural language description into a complete HTTP request. Description: "${description}".
Available env variables (use them when appropriate):
${envList}
Provide method, full URL, headers, params, and a sample body if applicable. Use {{variable_name}} for secrets or env variables. Return JSON with an action FILL_REQUEST only.`;
}

/**
 * Convenience: pull env vars from a context-like object. Tolerant of
 * objects whose `environmentVariables` is undefined.
 */
export function buildNaturalLanguagePromptFromContext(
  description: string,
  ctx: { environmentVariables?: Record<string, unknown> }
): string {
  return buildNaturalLanguagePrompt(description, ctx.environmentVariables ?? {});
}

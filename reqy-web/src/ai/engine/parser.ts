/**
 * AI engine — response parsing and validation.
 */

import type { AIResponse } from "./types";

/**
 * Validate the structural shape of an `AIResponse`. Used after JSON.parse
 * to fail fast on partially-formed model output.
 */
export function isValidAIResponse(value: unknown): value is AIResponse {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.summary !== "string") return false;
  if (!Array.isArray(obj.actions)) return false;
  for (const action of obj.actions) {
    if (typeof action !== "object" || action === null) return false;
    const a = action as Record<string, unknown>;
    if (typeof a.type !== "string") return false;
    if (typeof a.payload !== "object" || a.payload === null) return false;
  }
  return true;
}

/**
 * Parse raw model output into AIResponse.
 * - Strips markdown code fences and backticks
 * - Attempts JSON.parse, falling back to brace-matching heuristics
 */
export function parseAIResponse(raw: string): AIResponse {
  const cleaned = raw
    .replace(/```json\s*/g, "")
    .replace(/```/g, "")
    .replace(/`/g, "")
    .trim();

  // Primary: full JSON parse
  try {
    const parsed = JSON.parse(cleaned);
    if (isValidAIResponse(parsed)) return parsed;
  } catch {
    // continue to fallback
  }

  // SECURITY FIX H9: Safer fallback than simple substring heuristic
  // Only try to extract JSON if it starts with { and ends with }
  const jsonMatches = cleaned.match(/^\s*\{[\s\S]*\}\s*$/);
  if (jsonMatches) {
    try {
      const parsed = JSON.parse(jsonMatches[0]);
      if (isValidAIResponse(parsed)) return parsed;
    } catch {
      // fall through
    }
  }

  // IMPROVED FALLBACK: Validate we have matching braces, not just first/last
  const firstBrace = cleaned.indexOf("{");
  if (firstBrace === -1) {
    return {
      summary: "The AI response could not be parsed.",
      actions: [
        {
          type: "EXPLAIN",
          payload: { message: "No JSON object found in AI response." },
        },
      ],
    };
  }

  // Count braces to find the matching closing brace
  let depth = 0;
  let endBrace = -1;
  for (let i = firstBrace; i < cleaned.length; i++) {
    if (cleaned[i] === "{") depth++;
    if (cleaned[i] === "}") {
      depth--;
      if (depth === 0) {
        endBrace = i;
        break;
      }
    }
  }

  if (endBrace === -1) {
    return {
      summary: "The AI response could not be parsed.",
      actions: [
        {
          type: "EXPLAIN",
          payload: { message: "JSON braces are unmatched in AI response." },
        },
      ],
    };
  }

  const sub = cleaned.substring(firstBrace, endBrace + 1);
  try {
    const parsed = JSON.parse(sub);
    if (isValidAIResponse(parsed)) return parsed;
  } catch {
    // fall through
  }

  return {
    summary: "The AI response could not be parsed.",
    actions: [
      {
        type: "EXPLAIN",
        payload: {
          message:
            "The AI response could not be parsed as JSON. Check the developer console for details.",
        },
      },
    ],
  };
}

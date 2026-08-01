/**
 * AI engine — propose a correction for a failed assertion.
 *
 * This module is the read-only counterpart of the auto-repair flow: given a
 * failed assertion and the actual response, it asks the AI engine for a
 * *suggested* corrected assertion. It NEVER applies anything and NEVER
 * dispatches a mutating action (no EXECUTE_REQUEST / RUN_BATCH). The caller
 * decides whether to apply the suggestion, and only on an explicit user click.
 *
 * The AI call reuses the existing completion path (`callAIText` from
 * `./providers`) — no new AI client is introduced.
 */

import type { Assertion } from "@/lib/test-runner/types";
import {
  loadAIProvider,
  loadApiKey,
  loadAiBaseUrl,
  loadAiModel,
  loadOllamaConfig,
} from "@/lib/config";
import { callAIText } from "./providers";
import { SYSTEM_PROMPT } from "./prompts";

export interface CorrectionAssertionInput {
  expr?: string;
  type?: string;
  target?: string;
  operator?: string;
  value?: unknown;
}

export interface CorrectionSuggestion {
  expr?: string;
  type?: string;
  target?: string;
  operator?: string;
  value?: unknown;
}

export interface ProposeCorrectionInput {
  assertion: CorrectionAssertionInput;
  response: { status?: number; body?: unknown };
  endpoint: string;
}

export interface ProposeCorrectionResult {
  suggestion: CorrectionSuggestion;
  rationale: string;
}

/**
 * Build the focused prompt sent to the AI. It describes the failed assertion
 * and the actual observed response, and asks strictly for a JSON-correctable
 * suggestion (never an instruction to execute anything).
 */
function buildPrompt(input: ProposeCorrectionInput): string {
  const assertion = JSON.stringify(input.assertion);
  const status = input.response.status ?? "unknown";
  let bodyStr: string;
  try {
    bodyStr = input.response.body !== undefined ? JSON.stringify(input.response.body) : "none";
  } catch {
    bodyStr = String(input.response.body);
  }
  if (!bodyStr) bodyStr = "none";
  if (bodyStr.length > 4000) bodyStr = `${bodyStr.slice(0, 4000)}…`;

  return `This assertion failed: ${assertion}.
Actual response: status ${status}, body ${bodyStr}.
Endpoint: ${input.endpoint}

Suggest a corrected assertion that would PASS against this actual response.
Respond ONLY with a JSON object of this exact shape:
{ "suggestion": { "expr"?: string; "type"?: string; "target"?: string; "operator"?: string; "value"?: unknown }, "rationale": string }
Do NOT apply the change — only propose it.`;
}

/**
 * Default AI completion: reuse the exact same provider path as
 * `handleGenerateTests` (via `callAIText`). Only invoked when the caller does
 * not inject its own `askAI` (the UI always injects the real engine fn).
 */
function buildDefaultAskAI(): (prompt: string) => Promise<string> {
  return async (prompt: string) => {
    const provider = loadAIProvider();
    if (!provider) throw new Error("Configure ton provider IA dans Settings");
    const apiKey = provider === "ollama" ? "" : (loadApiKey(provider) ?? "");
    const model = loadAiModel(provider) || undefined;
    const openaiUrl =
      provider === "openai" || provider === "custom" || provider === "grok"
        ? loadAiBaseUrl(provider) || undefined
        : undefined;
    const ollamaConfig = loadOllamaConfig();
    const ollamaUrl =
      provider === "ollama"
        ? `http://${ollamaConfig.host || "127.0.0.1"}:${ollamaConfig.port ?? 11434}`
        : undefined;
    if (provider !== "ollama" && !apiKey.trim()) {
      throw new Error("Clé API manquante dans Settings");
    }
    return callAIText(prompt, {
      provider,
      apiKey: apiKey.trim(),
      model,
      openaiUrl,
      ollamaUrl,
      system: SYSTEM_PROMPT,
    });
  };
}

/** Extract the first JSON object from model output, tolerating code fences / prose. */
function extractJsonObject(raw: string): Record<string, unknown> | null {
  const cleaned = raw
    .replace(/```json\s*/g, "")
    .replace(/```/g, "")
    .replace(/`/g, "")
    .trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
  } catch {
    /* fall through to brace matching */
  }
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first !== -1 && last > first) {
    try {
      const parsed = JSON.parse(cleaned.slice(first, last + 1));
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function pickSuggestion(raw: unknown): CorrectionSuggestion {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const s = (obj.suggestion ?? {}) as Record<string, unknown>;
  return {
    expr: typeof s.expr === "string" ? s.expr : undefined,
    type: typeof s.type === "string" ? s.type : undefined,
    target: typeof s.target === "string" ? s.target : undefined,
    operator: typeof s.operator === "string" ? s.operator : undefined,
    value: s.value,
  };
}

/**
 * Ask the AI for a corrected assertion. Does not mutate anything — returns a
 * suggestion object only. `askAI` is injected by the UI (the real engine's
 * text completion); when omitted it falls back to `callAIText` with the
 * locally configured provider.
 */
export async function proposeAssertionCorrection(
  input: ProposeCorrectionInput,
  askAI?: (prompt: string) => Promise<string>,
): Promise<ProposeCorrectionResult> {
  const ask = askAI ?? buildDefaultAskAI();
  const prompt = buildPrompt(input);
  const raw = await ask(prompt);
  const parsed = extractJsonObject(raw);
  if (!parsed) {
    throw new Error("La proposition de correction n'a pas pu être analysée.");
  }
  return {
    suggestion: pickSuggestion(parsed),
    rationale: typeof parsed.rationale === "string" ? parsed.rationale : "",
  };
}

/* ── Conversion helpers (test-runner Assertion ↔ correction shape) ────────── */

/** Map a stored runner `Assertion` into the prompt input shape. */
export function assertionToInput(assertion: Assertion): CorrectionAssertionInput {
  switch (assertion.type) {
    case "status":
      return { type: "status", target: "status", value: assertion.expected };
    case "responseTime":
      return {
        type: "responseTime",
        target: "responseTime",
        operator: assertion.operator,
        value: assertion.valueMs,
      };
    case "jsonPath":
      return {
        type: "jsonPath",
        target: assertion.path,
        operator: assertion.operator,
        value: assertion.value,
      };
    case "schema":
      return { type: "schema", target: "schema", value: assertion.schema };
    default:
      return {};
  }
}

/** Parse a status code out of an `expr` string like "status == 404". */
function parseStatusFromExpr(expr?: string): number {
  if (!expr) return NaN;
  const match = expr.match(/(\d{3})/);
  return match ? Number(match[1]) : NaN;
}

/**
 * Convert a suggested correction back into a runner `Assertion`, preserving
 * the original shape/type where the suggestion is partial. Falls back to the
 * original assertion when nothing usable is provided.
 */
export function suggestionToAssertion(
  suggestion: CorrectionSuggestion,
  original: Assertion,
): Assertion {
  const type = suggestion.type ?? original.type;
  if (type === "status") {
    const raw =
      suggestion.value !== undefined
        ? Number(suggestion.value)
        : parseStatusFromExpr(suggestion.expr);
    const expected = Number.isFinite(raw) ? (raw as number) : 200;
    return { type: "status", expected };
  }
  if (type === "responseTime") {
    const op = (suggestion.operator as ">" | "<" | "<=" | ">=") || ">";
    const raw = suggestion.value !== undefined ? Number(suggestion.value) : 0;
    return {
      type: "responseTime",
      operator: op,
      valueMs: Number.isFinite(raw) ? (raw as number) : 0,
    };
  }
  if (type === "jsonPath") {
    const o = original as Extract<Assertion, { type: "jsonPath" }>;
    return {
      type: "jsonPath",
      path: suggestion.target ?? o.path,
      operator:
        (suggestion.operator as "equals" | "contains" | "exists" | "notExists") ?? o.operator,
      value: suggestion.value ?? o.value,
    };
  }
  if (type === "schema") {
    const o = original as Extract<Assertion, { type: "schema" }>;
    return {
      type: "schema",
      schema: (suggestion.value as Record<string, unknown>) ?? o.schema,
    };
  }
  return original;
}

/**
 * Cloud engine — propose a correction for a failed assertion (migré depuis
 * le moteur legacy `src/ai/engine/propose-correction.ts`).
 *
 * This module is the read-only counterpart of the auto-repair flow: given a
 * failed assertion and the actual response, it asks the AI engine for a
 * *suggested* corrected assertion. It NEVER applies anything and NEVER
 * dispatches a mutating action (no EXECUTE_REQUEST / RUN_BATCH). The caller
 * decides whether to apply the suggestion, and only on an explicit user click.
 *
 * The AI call reuses the cloud-engine mono-shot adapter
 * (`callAITextViaStream`) — no new AI client is introduced.
 */

import type { Assertion } from "@/lib/test-runner/types";
import type { TestResult } from "@/lib/types";
import { maskSensitivePayload } from "../prompt";
import {
  loadAIProvider,
  loadApiKey,
  loadAiBaseUrl,
  loadAiModel,
  loadOllamaConfig,
} from "@/lib/config";
import { callAITextViaStream } from "@/src/ai/cloud-engine/text";
import { ACTIONS_SYSTEM_PROMPT } from "./prompts";

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
    bodyStr =
      input.response.body !== undefined
        ? JSON.stringify(maskSensitivePayload(input.response.body))
        : "none";
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
 * Default AI completion: routed through the cloud-engine mono-shot adapter
 * (`callAITextViaStream`). Seul appelé quand le caller n'injecte pas son
 * propre `askAI` (l'UI injecte toujours le vrai moteur).
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
    if (provider !== "ollama" && !apiKey.trim()) {
      throw new Error("Clé API manquante dans Settings");
    }
    return callAITextViaStream({
      provider,
      apiKey: apiKey.trim(),
      model,
      openaiUrl,
      host: provider === "ollama" ? ollamaConfig.host : undefined,
      port: provider === "ollama" ? ollamaConfig.port : undefined,
      system: ACTIONS_SYSTEM_PROMPT,
      rawMessage: prompt,
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
 * suggestion object only. `askAI` est injecté par l'UI (le vrai moteur,
 * `useAIEngine().sendMessage` → `callAITextViaStream`) ; en son absence on
 * retombe sur `callAITextViaStream` avec le provider configuré localement.
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
 * Why a suggestion could not be converted into an applicable assertion.
 * Stable codes — the UI maps them to translated messages.
 */
export type IncompleteReason = "no_usable_expected_status" | "no_usable_response_time_value";

/**
 * Result of converting a suggestion back into a runner `Assertion`.
 * `incomplete` means the model failed to provide a usable expected value:
 * the caller MUST NOT fall back to a trivial assertion (e.g. status 200).
 */
export type SuggestionConversion =
  { status: "ok"; assertion: Assertion } | { status: "incomplete"; reason: IncompleteReason };

/**
 * Pre-check used by the UI to disable "Appliquer" and show why a suggestion
 * is incomplete, before any apply attempt. Mirrors {@link convertSuggestion}
 * rules exactly; pass the original assertion's type so partial suggestions
 * are judged against the same effective type as the real conversion.
 */
export function evaluateSuggestionCompleteness(
  suggestion: CorrectionSuggestion,
  originalType?: string,
): { complete: boolean; reason?: IncompleteReason } {
  const type = suggestion.type ?? originalType ?? "status";
  if (type === "status") {
    const raw =
      suggestion.value !== undefined
        ? Number(suggestion.value)
        : parseStatusFromExpr(suggestion.expr);
    return Number.isFinite(raw)
      ? { complete: true }
      : { complete: false, reason: "no_usable_expected_status" };
  }
  if (type === "responseTime") {
    const raw = suggestion.value !== undefined ? Number(suggestion.value) : NaN;
    return Number.isFinite(raw)
      ? { complete: true }
      : { complete: false, reason: "no_usable_response_time_value" };
  }
  // jsonPath / schema keep original anchors when the suggestion is partial —
  // always convertible.
  return { complete: true };
}

/**
 * Recompute the display fields (`target`/`expected`) exactly as
 * `request-executor.toTestResults` renders them, so callers can verify that a
 * stored runner assertion still matches the failed result a correction was
 * proposed for (index anchoring can go stale after user edits).
 */
function describeAssertionForDisplay(assertion: Assertion): { target: string; expected: string } {
  switch (assertion.type) {
    case "status":
      return { target: "status", expected: JSON.stringify(assertion.expected) };
    case "responseTime":
      return {
        target: "response time",
        expected: `${assertion.operator} ${assertion.valueMs}ms`,
      };
    case "jsonPath":
      return {
        target: assertion.path,
        expected: `${assertion.operator}${
          assertion.value !== undefined ? ` ${JSON.stringify(assertion.value)}` : ""
        }`,
      };
    case "schema":
      return { target: "schema", expected: "schema validation" };
    default:
      return { target: assertion.type, expected: "" };
  }
}

/**
 * Guard for index-anchored application: returns false when the assertion at
 * the computed index no longer corresponds to the failed result shown in the
 * suggestion (type/target/expected drift after user edits), so callers refuse
 * to overwrite instead of silently corrupting a different assertion.
 */
export function assertionMatchesResult(original: Assertion, result: TestResult): boolean {
  if (result.type !== original.type) return false;
  const display = describeAssertionForDisplay(original);
  if (result.target !== display.target) return false;
  return (result.expected ?? "") === display.expected;
}

/**
 * STRICT conversion used by the live editor ("Appliquer" flow). Returns a
 * discriminated result: when the model provides no usable expected value, the
 * caller receives `{ status: "incomplete", reason }` instead of a trivial
 * assertion, and MUST surface it rather than apply anything.
 */
export function convertSuggestion(
  suggestion: CorrectionSuggestion,
  original: Assertion,
): SuggestionConversion {
  const type = suggestion.type ?? original.type;
  if (type === "status") {
    const raw =
      suggestion.value !== undefined
        ? Number(suggestion.value)
        : parseStatusFromExpr(suggestion.expr);
    if (!Number.isFinite(raw)) {
      return { status: "incomplete", reason: "no_usable_expected_status" };
    }
    return { status: "ok", assertion: { type: "status", expected: raw as number } };
  }
  if (type === "responseTime") {
    const op = (suggestion.operator as ">" | "<" | "<=" | ">=") || ">";
    const raw = suggestion.value !== undefined ? Number(suggestion.value) : NaN;
    if (!Number.isFinite(raw)) {
      return { status: "incomplete", reason: "no_usable_response_time_value" };
    }
    return {
      status: "ok",
      assertion: { type: "responseTime", operator: op, valueMs: raw as number },
    };
  }
  if (type === "jsonPath") {
    const o = original as Extract<Assertion, { type: "jsonPath" }>;
    return {
      status: "ok",
      assertion: {
        type: "jsonPath",
        path: suggestion.target ?? o.path,
        operator:
          (suggestion.operator as "equals" | "contains" | "exists" | "notExists") ?? o.operator,
        value: suggestion.value ?? o.value,
      },
    };
  }
  if (type === "schema") {
    const o = original as Extract<Assertion, { type: "schema" }>;
    return {
      status: "ok",
      assertion: {
        type: "schema",
        schema: (suggestion.value as Record<string, unknown>) ?? o.schema,
      },
    };
  }
  return { status: "ok", assertion: original };
}

/**
 * Legacy-compatible conversion kept for existing callers that expect an
 * `Assertion` directly (e.g. the collection runner page). Incomplete
 * suggestions resolve to the ORIGINAL assertion unchanged — the historical
 * silent fallbacks (`expected: 200`, `valueMs: 0`) are gone. New code should
 * use {@link convertSuggestion} to surface incompleteness explicitly.
 */
export function suggestionToAssertion(
  suggestion: CorrectionSuggestion,
  original: Assertion,
): Assertion {
  const conversion = convertSuggestion(suggestion, original);
  return conversion.status === "ok" ? conversion.assertion : original;
}

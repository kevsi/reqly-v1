/**
 * Simple mode — natural-language → request mapping.
 *
 * This module is the pure, unit-testable core of "Mode simple" (Task 13).
 * It turns a natural-language description into a structured request by reusing
 * the EXISTING AI engine's text-completion path (the same `callAIText` +
 * JSON-extraction path used by Task 5's `propose-correction`). No new AI
 * client is introduced: callers inject the engine's text completion function
 * (in the UI this is `useAIEngine().sendMessage`, which wraps `callAIText`
 * with the configured provider).
 *
 * Responsibilities:
 *   - `normalizeMethod` / `nlArgsToRequest`: map a `build_request` args object
 *     into the app's `RequestItem` persistence shape.
 *   - `parseBuildRequestArgs`: robustly extract those args from raw model
 *     output (JSON, possibly wrapped in a `build_request` key, possibly inside
 *     prose).
 *   - `generateRequestFromNL`: orchestrate askAI(prompt) → parse → map.
 */

import type { HttpMethod, RequestItem } from "@/lib/types";

/** Shape requested from the AI, mirroring a `build_request` function call. */
export interface BuildRequestArgs {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
}

/** Shape ready to be persisted via `addRequestToCollection`. */
export type SavableRequestItem = Omit<RequestItem, "id" | "createdAt" | "updatedAt">;

const VALID_METHODS: HttpMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
  "GRAPHQL",
];

/** Normalize a raw method string into a known `HttpMethod` (defaults to GET). */
export function normalizeMethod(method: string): HttpMethod {
  const m = typeof method === "string" ? method.trim().toUpperCase() : "";
  return VALID_METHODS.includes(m as HttpMethod) ? (m as HttpMethod) : "GET";
}

/**
 * Map a `build_request` args object into a savable `RequestItem`.
 * - object/number bodies are JSON-serialized (bodyType "json")
 * - string bodies are kept as raw text (bodyType "raw")
 * - missing headers/body fall back to empty defaults
 */
export function nlArgsToRequest(args: BuildRequestArgs): SavableRequestItem {
  const method = normalizeMethod(args.method);
  const url = typeof args.url === "string" ? args.url.trim() : "";
  const headers = args.headers && typeof args.headers === "object" ? { ...args.headers } : {};
  const rawBody = args.body;
  const hasBody = rawBody !== undefined && rawBody !== null && rawBody !== "";
  const body = hasBody ? (typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody)) : "";
  const bodyType = hasBody ? (typeof rawBody === "string" ? "raw" : "json") : undefined;
  const endpoint = url.replace(/^https?:\/\/[^/]+/, "") || "/";

  return {
    name: url ? `${method} ${url}` : method,
    method,
    url,
    endpoint,
    headers,
    queryParams: [],
    body,
    bodyType,
  } as SavableRequestItem;
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

/**
 * Parse raw AI output into `BuildRequestArgs`.
 * Accepts either `{ "build_request": { ... } }` or a bare args object.
 * Throws a readable French error when nothing usable could be extracted.
 */
export function parseBuildRequestArgs(raw: string): BuildRequestArgs {
  const obj = extractJsonObject(raw);
  if (!obj) {
    throw new Error("La description n'a pas pu être convertie en requête.");
  }
  const candidate =
    obj.build_request && typeof obj.build_request === "object"
      ? (obj.build_request as Record<string, unknown>)
      : obj;
  const url = typeof candidate.url === "string" ? candidate.url.trim() : "";
  if (!url) {
    throw new Error("Aucune URL valide n'a été générée.");
  }
  return {
    method: typeof candidate.method === "string" ? candidate.method : "GET",
    url,
    headers:
      candidate.headers && typeof candidate.headers === "object"
        ? (candidate.headers as Record<string, string>)
        : undefined,
    body: candidate.body,
  };
}

/** Build the focused prompt sent to the AI for the `build_request` schema. */
function buildPrompt(description: string): string {
  return `Convertis la description suivante en une requête HTTP. Réponds UNIQUEMENT avec un objet JSON de cette forme exacte (les champs optionnels peuvent être omis) :
{ "build_request": { "method": "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS", "url": "https://...", "headers"?: { "Clé": "Valeur" }, "body"?: <objet JSON ou chaîne> } }

Règles :
- Utilise l'URL complète (avec https://).
- Pour "body", privilégie un objet JSON quand la description contient des données structurées.
- N'invente pas de valeurs sensibles (tokens, clés) ; utilise des espaces réservés si besoin.

Description : ${description}`;
}

/**
 * Generate a request from a natural-language description by calling the
 * injected AI text-completion function (the existing engine). Returns a
 * savable `RequestItem`. `askAI` is the engine's text completion (in the UI:
 * `useAIEngine().sendMessage`, which reuses `callAIText`).
 */
export async function generateRequestFromNL(
  description: string,
  askAI: (prompt: string) => Promise<string>,
): Promise<SavableRequestItem> {
  const raw = await askAI(buildPrompt(description));
  const args = parseBuildRequestArgs(raw);
  return nlArgsToRequest(args);
}

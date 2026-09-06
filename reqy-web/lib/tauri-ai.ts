/**
 * Provider parity: this desktop adapter mirrors app/api/proxy-ai/route.ts.
 * Any provider, validation, timeout, or response-format change must be replicated in both paths.
 */
import { invokeTauriFetch } from "@/lib/tauri";
import type { AIProvider } from "@/lib/types";
import type { ModelOption } from "./provider-models";
import {
  buildOpenAIToolHistory,
  buildAnthropicToolHistory,
  buildGeminiToolHistory,
  type PreviousTurn,
} from "@/src/ai/lib/tool-history";

export const PROVIDER_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  ollama: "http://127.0.0.1:11434",
  openrouter: "https://openrouter.ai/api/v1",
  deepseek: "https://api.deepseek.com/v1",
  grok: "https://api.x.ai/v1",
  "opencode-zen": "https://opencode.ai/zen/v1",
};

/** Shape minimale d'une entrée de la réponse /models d'un provider. */
interface ModelRecord {
  id?: unknown;
  name?: unknown;
  display_name?: unknown;
  displayName?: unknown;
  type?: unknown;
  supportedGenerationMethods?: unknown;
}

const TAURI_AI_TIMEOUT_MS = 60_000;

function isRecord(m: unknown): m is Record<string, unknown> {
  return typeof m === "object" && m !== null;
}

async function invokeTauriFetchWithTimeout(
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: string,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      invokeTauriFetch(method, url, headers, body),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("AI provider request timed out")),
          TAURI_AI_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function isModelRecord(m: unknown): m is ModelRecord {
  return isRecord(m);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Validate the direct desktop Ollama target. Local loopback is intentional in
 * Tauri, but URL syntax, authority injection and invalid ports are rejected.
 * The server proxy keeps its stricter DNS/IP SSRF policy in url-utils.ts.
 */
export function normalizeOllamaTarget(
  hostValue: unknown,
  portValue: unknown,
): { host: string; port: number } {
  const host = typeof hostValue === "string" && hostValue.trim() ? hostValue.trim() : "127.0.0.1";
  if (host.length > 253 || /[\s/?#@\\]/.test(host) || host.includes(":")) {
    throw new Error("Invalid Ollama host");
  }
  const port =
    typeof portValue === "number"
      ? portValue
      : typeof portValue === "string" && portValue.trim()
        ? Number(portValue.trim())
        : 11434;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Invalid Ollama port");
  }
  return { host, port };
}

function normalizeModelsOpenAI(data: unknown[]): ModelOption[] {
  return data.filter(isModelRecord).map((m) => {
    const id = str(m.id);
    return { id, label: str(m.name) || id };
  });
}

function normalizeModelsAnthropic(data: unknown[]): ModelOption[] {
  return data
    .filter((m): m is ModelRecord => isModelRecord(m) && m.type === "model")
    .map((m) => {
      const id = str(m.id);
      return { id, label: str(m.display_name) || id };
    });
}

function normalizeModelsGemini(data: unknown[]): ModelOption[] {
  return data
    .filter(
      (m): m is ModelRecord =>
        isModelRecord(m) &&
        Array.isArray(m.supportedGenerationMethods) &&
        (m.supportedGenerationMethods as unknown[]).includes("generateContent"),
    )
    .map((m) => {
      const id = str(m.name).replace(/^models\//, "");
      return { id, label: str(m.displayName) || id };
    });
}

function normalizeModelsOllama(data: unknown[]): ModelOption[] {
  return data
    .filter((m): m is ModelRecord => isModelRecord(m) && typeof m.name === "string")
    .map((m) => {
      const id = str(m.name);
      return { id, label: id };
    });
}

function normalizeModelsOpenRouter(data: unknown[]): ModelOption[] {
  return data.filter(isModelRecord).map((m) => {
    const id = str(m.id);
    return { id, label: str(m.name) || id };
  });
}

export function normalizeModelsResponse(provider: AIProvider, raw: unknown): ModelOption[] {
  const obj = isRecord(raw) ? raw : {};
  const data = obj.data ?? obj.models ?? [];
  const arr = Array.isArray(data) ? data : [];

  switch (provider) {
    case "anthropic":
      return normalizeModelsAnthropic(arr);
    case "gemini":
      return normalizeModelsGemini(arr);
    case "ollama":
      return normalizeModelsOllama(arr);
    case "openrouter":
      return normalizeModelsOpenRouter(arr);
    case "openai":
    case "deepseek":
    case "grok":
    case "opencode-zen":
    case "custom":
    default:
      return normalizeModelsOpenAI(arr);
  }
}

export async function fetchModelsTauri(
  provider: AIProvider,
  apiKey: string,
  baseUrl: string,
): Promise<ModelOption[]> {
  const url = PROVIDER_URLS[provider] ?? (baseUrl || "https://api.openai.com/v1");
  const fullUrl = `${url.replace(/\/+$/, "")}/models`;

  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (provider === "anthropic") {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else if (provider === "gemini") {
    headers["x-goog-api-key"] = apiKey;
  } else if (provider !== "ollama") {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const res = await invokeTauriFetch("GET", fullUrl, headers);

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`HTTP ${res.status}: ${res.body.slice(0, 200)}`);
  }

  const raw = JSON.parse(res.body);
  const models = normalizeModelsResponse(provider, raw);

  if (models.length === 0) throw new Error("Empty list");
  return models;
}

export interface TauriAIResult {
  content: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  /** `reasoning_content` du message assistant (DeepSeek reasoner / thinking). */
  reasoningContent?: string;
}

function randomCallId(): string {
  return `call_${Math.random().toString(36).slice(2)}`;
}

/** Tool au format OpenAI (passé par le frontend). */
interface OpenAIStyleTool {
  type?: unknown;
  function?: Record<string, unknown>;
  name?: unknown;
  description?: unknown;
  parameters?: unknown;
  input_schema?: unknown;
}

function toOpenAITool(t: Record<string, unknown>): OpenAIStyleTool {
  return t as OpenAIStyleTool;
}

/** Bloc `content[]` de la réponse Anthropic. */
interface AnthropicContentBlock {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

/** `parts[]` + functionCall d'une candidate Gemini. */
interface GeminiFunctionCall {
  id?: string;
  name?: string;
  args?: unknown;
}

interface GeminiPart {
  text?: string;
  functionCall?: GeminiFunctionCall;
}

interface GeminiCandidate {
  content?: { parts?: GeminiPart[]; text?: string };
  text?: string;
  functionCall?: GeminiFunctionCall;
}

/** Message assistant des API OpenAI-compatibles (openai, ollama, deepseek…). */
interface OpenAIChatMessage {
  content?: string;
  tool_calls?: unknown;
  reasoning_content?: unknown;
}

interface OpenAIToolCall {
  id?: string;
  function?: { name?: string; arguments?: string };
}

/**
 * Appelle un provider IA via le backend Tauri (fetch natif).
 *
 * Contrairement au proxy web, ce chemin passe par l'IPC natif : on doit donc
 * convertir les tools vers le format du provider ET parser les tool_calls de
 * la réponse nous-mêmes (le proxy web le fait côté serveur).
 */
export async function callAiProxyTauri(payload: Record<string, unknown>): Promise<TauriAIResult> {
  const provider = payload.provider as string;
  const apiKey = (payload.apiKey as string) ?? "";
  const model = (payload.model as string) ?? "";
  const message = (payload.message as string) ?? "";
  const system = (payload.system as string) ?? "";
  const tools = Array.isArray(payload.tools)
    ? (payload.tools as Record<string, unknown>[])
    : undefined;
  const toolChoice = payload.tool_choice as string | Record<string, unknown> | undefined;
  const previousTurns = Array.isArray(payload.previousTurns)
    ? (payload.previousTurns as PreviousTurn[])
    : undefined;

  let url: string;
  let body: Record<string, unknown>;

  switch (provider) {
    case "anthropic": {
      url = "https://api.anthropic.com/v1/messages";
      const anthropicTools = tools?.map((t) => {
        const tool = toOpenAITool(t);
        const fn = isRecord(tool.function) ? tool.function : t;
        return {
          name: fn.name,
          description: fn.description,
          input_schema: fn.parameters ?? fn.input_schema ?? {},
        };
      });
      body = {
        model,
        max_tokens: 4096,
        system,
        messages: [{ role: "user", content: message }, ...buildAnthropicToolHistory(previousTurns)],
        stream: false,
        ...(anthropicTools?.length ? { tools: anthropicTools } : {}),
      };
      break;
    }
    case "gemini": {
      url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      const geminiTools = tools?.length
        ? [
            {
              functionDeclarations: tools.map((t) => {
                const tool = toOpenAITool(t);
                const fn = isRecord(tool.function) ? tool.function : t;
                return {
                  name: fn.name,
                  description: fn.description,
                  parameters: fn.parameters ?? {},
                };
              }),
            },
          ]
        : undefined;
      body = {
        system_instruction: { parts: [{ text: system }] },
        contents: [
          { role: "user", parts: [{ text: message }] },
          ...buildGeminiToolHistory(previousTurns),
        ],
        ...(geminiTools?.length ? { tools: geminiTools } : {}),
      };
      break;
    }
    case "ollama": {
      const target = normalizeOllamaTarget(payload.host, payload.port);
      const host = target.host;
      const port = target.port;
      url = `http://${host}:${port}/v1/chat/completions`;
      body = {
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: message },
          // Round-trip `reasoning_content` (qwen3 thinking…) — inerte si absent.
          ...buildOpenAIToolHistory(previousTurns, { includeReasoning: true }),
        ],
        stream: false,
        ...(tools?.length ? { tools } : {}),
        ...(toolChoice !== undefined ? { tool_choice: toolChoice } : {}),
      };
      break;
    }
    default: {
      // OpenAI-compatible providers (openai, deepseek, openrouter, grok, custom...)
      const baseUrl =
        (payload.openaiUrl as string) || PROVIDER_URLS[provider] || "https://api.openai.com/v1";
      url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
      body = {
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: message },
          // Round-trip `reasoning_content` (DeepSeek reasoner / thinking via
          // openrouter, custom, grok...). Champ ajouté uniquement s'il existe
          // dans le tour → inerte pour les modèles sans reasoning.
          ...buildOpenAIToolHistory(previousTurns, { includeReasoning: true }),
        ],
        stream: false,
        ...(tools?.length ? { tools } : {}),
        ...(toolChoice !== undefined ? { tool_choice: toolChoice } : {}),
      };
      break;
    }
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (provider === "anthropic") {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else if (provider === "gemini") {
    headers["x-goog-api-key"] = apiKey;
  } else if (provider !== "ollama" && provider !== "gemini") {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const res = await invokeTauriFetchWithTimeout("POST", url, headers, JSON.stringify(body));

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`HTTP ${res.status}: ${res.body.slice(0, 200)}`);
  }

  const json = JSON.parse(res.body);

  // Anthropic : blocs content[] de type text + tool_use
  if (provider === "anthropic") {
    const contentData = Array.isArray(json?.content)
      ? (json.content as AnthropicContentBlock[])
      : [];
    const textContent = contentData
      .filter((item) => item.type === "text")
      .map((item) => item.text ?? "")
      .join("");
    const toolUses = contentData
      .filter((item) => item.type === "tool_use")
      .map((item) => ({
        id: item.id ?? randomCallId(),
        name: item.name ?? "",
        arguments: JSON.stringify(item.input ?? {}),
      }));
    return {
      content: textContent,
      ...(toolUses.length > 0 ? { toolCalls: toolUses } : {}),
    };
  }

  // Gemini : candidates[0].functionCall (ou parts[].functionCall)
  if (provider === "gemini") {
    const candidates = Array.isArray(json?.candidates)
      ? (json.candidates as GeminiCandidate[])
      : [];
    const firstCandidate = candidates[0];
    const parts = Array.isArray(firstCandidate?.content?.parts) ? firstCandidate.content.parts : [];
    const textContent =
      parts
        .map((p) => p?.text ?? "")
        .join("")
        .trim() ||
      firstCandidate?.content?.text ||
      firstCandidate?.text ||
      "";
    const fc = firstCandidate?.functionCall ?? parts.find((p) => p?.functionCall)?.functionCall;
    if (fc?.name) {
      return {
        content: textContent,
        toolCalls: [
          {
            id: fc.id ?? randomCallId(),
            name: fc.name,
            arguments: JSON.stringify(fc.args ?? {}),
          },
        ],
      };
    }
    return { content: textContent };
  }

  // Ollama + OpenAI-compatible : message.tool_calls
  const msg = json?.choices?.[0]?.message as OpenAIChatMessage | undefined;
  const rawToolCalls = Array.isArray(msg?.tool_calls) ? (msg.tool_calls as OpenAIToolCall[]) : [];
  const toolCalls = rawToolCalls
    .map((tc) => ({
      id: typeof tc?.id === "string" ? tc.id : randomCallId(),
      name: typeof tc?.function?.name === "string" ? tc.function.name : "",
      arguments: typeof tc?.function?.arguments === "string" ? tc.function.arguments : "{}",
    }))
    .filter((tc) => tc.name);
  const reasoningContent =
    typeof msg?.reasoning_content === "string" && msg.reasoning_content.length > 0
      ? msg.reasoning_content
      : undefined;

  return {
    content: typeof msg?.content === "string" ? msg.content : "",
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
    ...(reasoningContent ? { reasoningContent } : {}),
  };
}

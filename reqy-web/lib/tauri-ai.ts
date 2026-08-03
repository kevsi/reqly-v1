import { invokeTauriFetch } from "@/lib/tauri"
import type { AIProvider } from "@/lib/types"
import type { ModelOption } from "./provider-models"
import {
  buildOpenAIToolHistory,
  buildAnthropicToolHistory,
  buildGeminiToolHistory,
  type PreviousTurn,
} from "@/app/api/proxy-ai/lib/tool-history"

export const PROVIDER_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  ollama: "http://127.0.0.1:11434",
  openrouter: "https://openrouter.ai/api/v1",
  deepseek: "https://api.deepseek.com/v1",
  grok: "https://api.x.ai/v1",
  "opencode-zen": "https://opencode.ai/zen/v1",
}

function normalizeModelsOpenAI(data: unknown[]): ModelOption[] {
  return data
    .filter((m) => typeof m === "object" && m !== null)
    .map((m: any) => ({ id: m.id, label: m.name ?? m.id }))
}

function normalizeModelsAnthropic(data: unknown[]): ModelOption[] {
  return data
    .filter((m) => typeof m === "object" && m !== null && (m as any).type === "model")
    .map((m: any) => ({ id: m.id, label: m.display_name ?? m.id }))
}

function normalizeModelsGemini(data: unknown[]): ModelOption[] {
  return data
    .filter(
      (m) =>
        typeof m === "object" &&
        m !== null &&
        Array.isArray((m as any).supportedGenerationMethods) &&
        (m as any).supportedGenerationMethods.includes("generateContent"),
    )
    .map((m: any) => {
      const id = (m.name ?? "").replace(/^models\//, "")
      return { id, label: m.displayName ?? id }
    })
}

function normalizeModelsOllama(data: unknown[]): ModelOption[] {
  return data
    .filter((m) => typeof m === "object" && m !== null && typeof (m as any).name === "string")
    .map((m: any) => ({ id: m.name, label: m.name }))
}

function normalizeModelsOpenRouter(data: unknown[]): ModelOption[] {
  return data
    .filter((m) => typeof m === "object" && m !== null)
    .map((m: any) => ({ id: m.id, label: m.name ?? m.id }))
}

export function normalizeModelsResponse(provider: AIProvider, raw: unknown): ModelOption[] {
  const data = (raw as any)?.data ?? (raw as any)?.models ?? []
  const arr = Array.isArray(data) ? data : []

  switch (provider) {
    case "anthropic":
      return normalizeModelsAnthropic(arr)
    case "gemini":
      return normalizeModelsGemini(arr)
    case "ollama":
      return normalizeModelsOllama(arr)
    case "openrouter":
      return normalizeModelsOpenRouter(arr)
    case "openai":
    case "deepseek":
    case "grok":
    case "opencode-zen":
    case "custom":
    default:
      return normalizeModelsOpenAI(arr)
  }
}

export async function fetchModelsTauri(
  provider: AIProvider,
  apiKey: string,
  baseUrl: string,
): Promise<ModelOption[]> {
  const url = PROVIDER_URLS[provider] ?? (baseUrl || "https://api.openai.com/v1")
  const fullUrl = `${url.replace(/\/+$/, "")}/models`

  const headers: Record<string, string> = { "Content-Type": "application/json" }

  if (provider === "anthropic") {
    headers["x-api-key"] = apiKey
    headers["anthropic-version"] = "2023-06-01"
  } else if (provider === "gemini") {
    // API key goes in query string
  } else if (provider !== "ollama") {
    headers["Authorization"] = `Bearer ${apiKey}`
  }

  let requestUrl = fullUrl
  if (provider === "gemini") {
    requestUrl = `${fullUrl}?key=${encodeURIComponent(apiKey)}`
  }

  const res = await invokeTauriFetch("GET", requestUrl, headers)

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`HTTP ${res.status}: ${res.body.slice(0, 200)}`)
  }

  const raw = JSON.parse(res.body)
  const models = normalizeModelsResponse(provider, raw)

  if (models.length === 0) throw new Error("Empty list")
  return models
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

/**
 * Appelle un provider IA via le backend Tauri (fetch natif).
 *
 * Contrairement au proxy web, ce chemin passe par l'IPC natif : on doit donc
 * convertir les tools vers le format du provider ET parser les tool_calls de
 * la réponse nous-mêmes (le proxy web le fait côté serveur).
 */
export async function callAiProxyTauri(
  payload: Record<string, unknown>,
): Promise<TauriAIResult> {
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
        const fn = ((t as any).function as Record<string, unknown> | undefined) ?? t;
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
        messages: [
          { role: "user", content: message },
          ...buildAnthropicToolHistory(previousTurns),
        ],
        stream: false,
        ...(anthropicTools?.length ? { tools: anthropicTools } : {}),
      };
      break;
    }
    case "gemini": {
      url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const geminiTools = tools?.length
        ? [
            {
              functionDeclarations: tools.map((t) => {
                const fn = ((t as any).function as Record<string, unknown> | undefined) ?? t;
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
      const host = (payload.host as string) ?? "127.0.0.1";
      const port = (payload.port as number) ?? 11434;
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
        (payload.openaiUrl as string) ||
        PROVIDER_URLS[provider] ||
        "https://api.openai.com/v1";
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
  } else if (provider !== "ollama" && provider !== "gemini") {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const res = await invokeTauriFetch("POST", url, headers, JSON.stringify(body));

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`HTTP ${res.status}: ${res.body.slice(0, 200)}`);
  }

  const json = JSON.parse(res.body);

  // Anthropic : blocs content[] de type text + tool_use
  if (provider === "anthropic") {
    const contentData = Array.isArray(json?.content) ? json.content : [];
    const textContent = contentData
      .filter((item: any) => item?.type === "text")
      .map((item: any) => item.text ?? "")
      .join("");
    const toolUses = contentData
      .filter((item: any) => item?.type === "tool_use")
      .map((item: any) => ({
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
    const candidates = Array.isArray(json?.candidates) ? json.candidates : [];
    const firstCandidate = candidates[0] as any;
    const parts = Array.isArray(firstCandidate?.content?.parts)
      ? firstCandidate.content.parts
      : [];
    const textContent =
      parts
        .map((p: any) => p?.text ?? "")
        .join("")
        .trim() || firstCandidate?.content?.text || firstCandidate?.text || "";
    const fc =
      firstCandidate?.functionCall ??
      parts.find((p: any) => p?.functionCall)?.functionCall;
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
  const msg = json?.choices?.[0]?.message;
  const rawToolCalls: any[] = Array.isArray(msg?.tool_calls) ? msg.tool_calls : [];
  const toolCalls = rawToolCalls
    .map((tc: any) => ({
      id: typeof tc?.id === "string" ? tc.id : randomCallId(),
      name: typeof tc?.function?.name === "string" ? tc.function.name : "",
      arguments:
        typeof tc?.function?.arguments === "string" ? tc.function.arguments : "{}",
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

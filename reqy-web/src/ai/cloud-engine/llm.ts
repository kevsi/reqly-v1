/**
 * Phase 2.3 — LLM client (SSE streaming + tool calling)
 *
 * Streams tokens from /api/proxy-ai for any configured provider.
 * - OpenAI-compatible (openai, openrouter, opencode-zen, deepseek): server
 *   returns text/event-stream, we parse chunks.
 * - Anthropic / Gemini / Ollama: server ignores stream flag; yields single JSON
 *   content token.
 *
 * When `tools` is provided, the stream emits structured `LLMToken` events
 * instead of plain strings, so the caller can execute tool calls.
 */
import type { AIProvider, Diagnostic, RequestContext, RetrievedChunk } from "@/src/ai/types";
import { SYSTEM_PROMPT, buildUserPrompt } from "@/src/ai/cloud-engine/prompt";
import { type ToolDefinition, type ToolCall, type ToolResult, toOpenAITool } from "@/lib/llm-tools";
import { proxyAuthHeaders } from "@/lib/proxy-auth";
import { isTauriAvailable } from "@/lib/tauri";
import { callAiProxyTauri } from "@/lib/tauri-ai";
import {
  ProviderError,
  classifyProviderError,
  classifyThrownError,
} from "@/src/ai/cloud-engine/provider-errors";

/** Course IPC vs signal d'annulation client (desktop). */
function callWithAbortSignal<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () =>
      reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}
import { recordAICall } from "@/src/ai/cloud-engine/metrics";

export interface StreamLLMOptions {
  provider: AIProvider;
  apiKey: string;
  model?: string;
  host?: string;
  port?: number | string;
  openaiUrl?: string;
  /** Requis sauf si `rawMessage` est fourni. */
  question?: string;
  /** Requis sauf si `rawMessage` est fourni. */
  ctx?: RequestContext;
  diagnostics?: Diagnostic[];
  signal?: AbortSignal;
  /** Outils LLM exposés au modèle. Si absent, pas de function calling. */
  tools?: ToolDefinition[];
  /** Contrôle du comportement de sélection d'outils ("auto" par défaut). */
  tool_choice?: string | { type: string; name?: string };
  /** Tours précédents (tool_calls assistant + résultats) pour le multi-turn. */
  previousTurns?: Array<{
    assistantToolCalls: ToolCall[];
    toolResults: ToolResult[];
  }>;
  /**
   * Tours d'outils des messages PRÉCÉDENTS de la conversation (mémoire
   * inter-messages). Passés au provider AVANT le message courant — distinct
   * de `previousTurns` qui ne couvre que le send en cours.
   */
  historyTurns?: Array<{
    assistantToolCalls: ToolCall[];
    toolResults: ToolResult[];
  }>;
  /** Chunks RAG (résultats de recherche sémantique) injectés dans le prompt. */
  retrievedChunks?: RetrievedChunk[];
  /** Override du prompt système (défaut: SYSTEM_PROMPT). */
  system?: string;
  /**
   * Prompt utilisateur brut envoyé tel quel, SANS le wrapper de contexte de
   * `buildUserPrompt`. Alternative à `question` + `ctx` (utilisé par les
   * consommateurs migrés depuis `callAIText` du moteur legacy, dont les
   * prompts sont déjà auto-suffisants).
   */
  rawMessage?: string;
}

export interface LLMToolCallEvent {
  type: "tool_calls";
  calls: ToolCall[];
  /** `reasoning_content` du message assistant (DeepSeek reasoner / thinking). */
  reasoningContent?: string;
}

export interface LLMTextEvent {
  type: "text";
  value: string;
}

export interface LLMUsageEvent {
  type: "usage";
  usage: { inputTokens: number; outputTokens: number };
}

export type LLMToken = LLMTextEvent | LLMToolCallEvent | LLMUsageEvent;

export async function* streamLLM(opts: StreamLLMOptions): AsyncIterable<LLMToken> {
  const start = typeof performance !== "undefined" ? performance.now() : Date.now();
  let outcome: "success" | "error" | "timeout" = "success";
  let inputTokens = 0;
  let outputTokens = 0;
  try {
    for await (const token of streamLLMInternal(opts)) {
      if (token.type === "usage") {
        inputTokens += token.usage.inputTokens;
        outputTokens += token.usage.outputTokens;
      }
      yield token;
    }
  } catch (error) {
    outcome =
      error instanceof Error && /timeout|timed out/i.test(error.message) ? "timeout" : "error";
    throw error;
  } finally {
    const end = typeof performance !== "undefined" ? performance.now() : Date.now();
    recordAICall({
      provider: opts.provider,
      model: opts.model ?? "unknown",
      outcome,
      durationMs: end - start,
      inputTokens,
      outputTokens,
    });
  }
}

async function* streamLLMInternal(opts: StreamLLMOptions): AsyncIterable<LLMToken> {
  // Les providers attendent le format OpenAI ({type:"function", function:{...}}),
  // pas le format unifié Reqly ({name, description, parameters}). Convertir ici
  // garantit que les deux chemins (web et Tauri) envoient des tools valides.
  const openAITools = opts.tools?.map(toOpenAITool);

  // Prompt utilisateur : rawMessage auto-suffisant, sinon question+ctx requis.
  let userMessage: string;
  if (opts.rawMessage != null) {
    userMessage = opts.rawMessage;
  } else if (opts.question && opts.ctx) {
    userMessage = buildUserPrompt(
      opts.question,
      opts.ctx,
      opts.diagnostics ?? [],
      opts.retrievedChunks ?? [],
    );
  } else {
    throw new Error("streamLLM: fournir rawMessage, ou question + ctx.");
  }

  if (isTauriAvailable()) {
    // Phase 2 — parité desktop : le signal client est respecté (course avec
    // l'IPC) et les erreurs natives sont classifiées comme côté proxy.
    let result: Awaited<ReturnType<typeof callAiProxyTauri>>;
    try {
      result = await callWithAbortSignal(
        callAiProxyTauri({
          provider: opts.provider,
          apiKey: opts.apiKey,
          model: opts.model,
          host: opts.host,
          port: opts.port,
          openaiUrl: opts.openaiUrl,
          system: opts.system ?? SYSTEM_PROMPT,
          message: userMessage,
          tools: openAITools,
          tool_choice: opts.tool_choice,
          previousTurns: opts.previousTurns,
          historyTurns: opts.historyTurns,
        }),
        opts.signal,
      );
    } catch (e) {
      if ((e as { name?: string } | null)?.name === "AbortError") throw e;
      const cls = classifyThrownError(e, opts.provider);
      throw new ProviderError({ ...cls, detail: e instanceof Error ? e.message : String(e) });
    }
    if (result.content) {
      yield { type: "text", value: result.content };
    }
    if (result.toolCalls?.length) {
      yield {
        type: "tool_calls",
        calls: result.toolCalls,
        ...(result.reasoningContent ? { reasoningContent: result.reasoningContent } : {}),
      };
    }
    return;
  }

  const body: Record<string, unknown> = {
    provider: opts.provider,
    apiKey: opts.apiKey,
    model: opts.model,
    host: opts.host,
    port: opts.port,
    openaiUrl: opts.openaiUrl,
    system: opts.system ?? SYSTEM_PROMPT,
    message: userMessage,
    stream: true,
  };

  if (openAITools && openAITools.length > 0) {
    body.tools = openAITools;
    body.tool_choice = opts.tool_choice ?? "auto";
  }

  if (opts.previousTurns && opts.previousTurns.length > 0) {
    body.previousTurns = opts.previousTurns;
  }

  if (opts.historyTurns && opts.historyTurns.length > 0) {
    body.historyTurns = opts.historyTurns;
  }

  const res = await fetch("/api/proxy-ai", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...proxyAuthHeaders(),
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!res.ok) {
    let errMsg = `Proxy error ${res.status}`;
    try {
      const j: Record<string, unknown> = await res.json();
      errMsg = typeof j?.error === "string" ? j.error : errMsg;
    } catch {
      /* ignore non-JSON error body */
    }
    // Phase 2 — erreur provider classifiée : message FR actionnable + code
    // stable consommable par le hook (retry auto, actions banner).
    const retryAfter = res.headers.get("retry-after");
    const cls = classifyProviderError({
      status: res.status,
      message: errMsg,
      provider: opts.provider,
      retryAfterHeader: retryAfter,
    });
    throw new ProviderError({ ...cls, detail: errMsg });
  }

  const contentType = res.headers.get("content-type") ?? "";

  // Si tools sont demandés, on ne fait PAS de passthrough SSE :
  // il faut parser delta.tool_calls au niveau du stream.
  const canPassthrough =
    contentType.includes("text/event-stream") && res.body && !opts.tools?.length;

  if (canPassthrough) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // Normalisation CRLF : un provider émettant \r\n\r\n produirait sinon
      // aucun séparateur \n\n → buffer infini + spinner jusqu'au timeout.
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

      let sep = buffer.indexOf("\n\n");
      while (sep !== -1) {
        const rawEvent = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);

        for (const line of rawEvent.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const json = JSON.parse(payload);
            // Usage (chemin dégradé sans tools) — comptabilisé aussi.
            if (json?.usage && typeof json.usage === "object") {
              yield {
                type: "usage",
                usage: {
                  inputTokens: Number(json.usage.prompt_tokens ?? 0),
                  outputTokens: Number(json.usage.completion_tokens ?? 0),
                },
              };
            }
            const token: unknown = json?.choices?.[0]?.delta?.content;
            if (typeof token === "string" && token.length > 0) {
              yield { type: "text", value: token };
            }
          } catch {
            /* malformed line — skip */
          }
        }

        sep = buffer.indexOf("\n\n");
      }
    }
    return;
  }

  // Branche parsing SSE custom (tools présents ou pas SSE natif).
  if (contentType.includes("text/event-stream") && res.body && opts.tools?.length) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    // Accumulateurs pour tool_calls OpenAI/DeepSeek/Ollama
    const toolCallAcc: Record<
      number,
      {
        id?: string;
        index: number;
        functionName?: string;
        arguments: string;
      }
    > = {};
    const toolCallOrder: number[] = [];
    // `reasoning_content` est émis en chunks `delta.reasoning_content` par les
    // modèles DeepSeek thinking mode. On l'accumule et on le joint à l'événement
    // tool_calls pour que le client puisse le renvoyer dans l'historique (obligatoire).
    let reasoningContent = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // Normalisation CRLF (même garde que le passthrough).
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

      let sep = buffer.indexOf("\n\n");
      while (sep !== -1) {
        const rawEvent = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);

        for (const line of rawEvent.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const json = JSON.parse(payload);
            const choice = json?.choices?.[0];
            const delta = choice?.delta;

            // Usage (chunk final OpenAI-compatible)
            const rawUsage = json?.usage;
            if (rawUsage) {
              yield {
                type: "usage",
                usage: {
                  inputTokens: Number(rawUsage?.prompt_tokens ?? rawUsage?.input_tokens ?? 0),
                  outputTokens: Number(rawUsage?.completion_tokens ?? rawUsage?.output_tokens ?? 0),
                },
              };
            }

            // Texte classique
            const textToken = delta?.content;
            if (typeof textToken === "string" && textToken.length > 0) {
              yield { type: "text", value: textToken };
            }

            // Raisonnement (DeepSeek thinking mode)
            const reasoningToken = delta?.reasoning_content;
            if (typeof reasoningToken === "string" && reasoningToken.length > 0) {
              reasoningContent += reasoningToken;
            }

            // Tool calls (format OpenAI-compatible)
            const toolCalls = delta?.tool_calls;
            if (Array.isArray(toolCalls)) {
              for (const tc of toolCalls) {
                const index = typeof tc?.index === "number" ? tc.index : 0;
                if (!(index in toolCallAcc)) {
                  toolCallAcc[index] = { index, arguments: "" };
                  toolCallOrder.push(index);
                }
                const acc = toolCallAcc[index];
                if (typeof tc?.id === "string" && !acc.id) {
                  acc.id = tc.id;
                }
                const fn = tc?.function;
                if (typeof fn?.name === "string" && !acc.functionName) {
                  acc.functionName = fn.name;
                }
                if (typeof fn?.arguments === "string") {
                  acc.arguments += fn.arguments;
                }
              }
            }

            // Fin de réponse : émettre les tool_calls accumulés
            const finishReason = choice?.finish_reason;
            if (finishReason === "tool_calls" || finishReason === "stop") {
              const calls: ToolCall[] = toolCallOrder
                .map((idx) => toolCallAcc[idx])
                .filter((acc) => acc.id && acc.functionName)
                .map((acc) => ({
                  id: acc!.id!,
                  name: acc!.functionName!,
                  arguments: acc!.arguments || "{}",
                }));
              if (calls.length > 0) {
                yield {
                  type: "tool_calls",
                  calls,
                  ...(reasoningContent ? { reasoningContent } : {}),
                };
              }
              // Reset pour un éventuel appel suivant
              for (const idx of toolCallOrder) delete toolCallAcc[idx];
              toolCallOrder.length = 0;
            }
          } catch {
            /* malformed line — skip */
          }
        }

        sep = buffer.indexOf("\n\n");
      }
    }
    return;
  }

  // JSON fallback (anthropic / gemini / ollama sans tools).
  const data = await res.json();
  if (typeof data?.error === "string") {
    throw new Error(data.error);
  }

  // Support tool_calls unifiés renvoyés par le proxy pour Anthropic/Gemini
  const returnedToolCalls = data?.tool_calls;
  if (Array.isArray(returnedToolCalls) && returnedToolCalls.length > 0) {
    yield {
      type: "tool_calls",
      calls: returnedToolCalls.map((tc) => ({
        id: typeof tc.id === "string" ? tc.id : `call_${Math.random().toString(36).slice(2)}`,
        name: typeof tc.name === "string" ? tc.name : "",
        arguments:
          typeof tc.arguments === "string" ? tc.arguments : JSON.stringify(tc.arguments ?? {}),
      })),
    };
    return;
  }

  if (typeof data?.content === "string" && data.content.length > 0) {
    yield { type: "text", value: data.content };
  }

  const usageRaw = data?.usage ?? data?.usageMetadata;
  if (usageRaw && typeof usageRaw === "object") {
    yield {
      type: "usage",
      usage: {
        inputTokens: Number(
          usageRaw?.input_tokens ??
            usageRaw?.promptTokens ??
            usageRaw?.promptTokenCount ??
            usageRaw?.prompt_eval_count ??
            0,
        ),
        outputTokens: Number(
          usageRaw?.output_tokens ??
            usageRaw?.completionTokens ??
            usageRaw?.candidatesTokenCount ??
            usageRaw?.eval_count ??
            0,
        ),
      },
    };
  }
}

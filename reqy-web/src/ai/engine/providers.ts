/**
 * AI engine — provider HTTP calls.
 *
 * `callAI` returns a parsed `AIResponse` (actionable JSON the UI can dispatch).
 * `callAIText` returns the raw text content for callers that want to consume
 * the model output directly (e.g. GraphQL query generators).
 *
 * Low-level HTTP/grouping utilities live in ./providers-utils.ts.
 */

import { DEFAULT_MODELS } from "@/lib/ai-config";
import { SYSTEM_PROMPT } from "./prompts";
import { parseAIResponse } from "./parser";
import {
  extractProxyError,
  extractStreamContent,
  fetchWithTimeout,
  getProviderGroup,
  parseSSEStream,
} from "./providers-utils";
import type { AIProvider, AIResponse } from "./types";

/**
 * Internal shared implementation for proxy-based providers.
 */
async function callProxyProvider(
  provider: AIProvider,
  userPrompt: string,
  system: string,
  model: string,
  apiKey: string,
  openaiUrl?: string,
): Promise<AIResponse> {
  const group = getProviderGroup(provider);
  const extra =
    group === "PROXY_API_KEY" &&
    (provider === "openai" || provider === "custom" || provider === "grok") &&
    openaiUrl
      ? { openaiUrl }
      : {};

  const res = await fetchWithTimeout("/api/proxy-ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider,
      apiKey,
      model,
      system,
      message: userPrompt,
      ...extra,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(extractProxyError(res, text, provider));
  }

  const data = await res.json();
  const content = typeof data.content === "string" ? data.content : JSON.stringify(data);
  return parseAIResponse(String(content));
}

/**
 * Ollama provider — talks to a local server directly (no proxy).
 */
async function callOllamaProvider(
  userPrompt: string,
  system: string,
  model: string,
  ollamaUrl?: string,
): Promise<AIResponse> {
  const url = ollamaUrl ?? "http://localhost:11434";
  const res = await fetchWithTimeout(`${url}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Connection: "keep-alive" },
    body: JSON.stringify({
      model: model ?? "llama3",
      stream: false,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  const content =
    data && data.message && data.message.content ? data.message.content : JSON.stringify(data);
  return parseAIResponse(String(content));
}

/**
 * callAI: calls the selected AI provider and returns parsed AIResponse.
 */
export async function callAI(
  userPrompt: string,
  config: {
    provider: AIProvider;
    apiKey?: string;
    model?: string;
    openaiUrl?: string;
    ollamaUrl?: string;
    system?: string; // optional override for SYSTEM_PROMPT
  },
): Promise<AIResponse> {
  const provider = config.provider;
  const model = config.model || DEFAULT_MODELS[provider] || "gpt-4o-mini";
  const systemPrompt = config.system ?? SYSTEM_PROMPT;

  try {
    const group = getProviderGroup(provider);
    if (group === "OLLAMA") {
      return await callOllamaProvider(userPrompt, systemPrompt, model, config.ollamaUrl);
    }
    if (!config.apiKey) throw new Error(`${provider} requires apiKey in config`);
    return await callProxyProvider(
      provider,
      userPrompt,
      systemPrompt,
      model,
      config.apiKey,
      config.openaiUrl,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      summary: "AI call failed.",
      actions: [
        {
          type: "EXPLAIN",
          payload: { message: `AI call failed: ${message}` },
        },
      ],
    };
  }
}

/**
 * callAIText: returns raw model text instead of parsed actions.
 */
export async function callAIText(
  userPrompt: string,
  config: {
    provider: AIProvider;
    apiKey?: string;
    model?: string;
    openaiUrl?: string;
    ollamaUrl?: string;
    system?: string;
  },
): Promise<string> {
  const provider = config.provider;
  const model = config.model || DEFAULT_MODELS[provider] || "gpt-4o-mini";
  const system = config.system ?? SYSTEM_PROMPT;

  if (provider === "ollama") {
    const url = config.ollamaUrl ?? "http://localhost:11434";
    const res = await fetchWithTimeout(`${url}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Connection: "keep-alive" },
      body: JSON.stringify({
        model: model ?? "llama3",
        stream: false,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPrompt },
        ],
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ollama API error ${res.status}: ${text}`);
    }
    const data = await res.json();
    return data && data.message && data.message.content
      ? String(data.message.content)
      : JSON.stringify(data);
  }

  if (!config.apiKey) throw new Error(`${provider} requires apiKey in config`);
  const group = getProviderGroup(provider);
  const extra =
    group === "PROXY_API_KEY" &&
    (provider === "openai" || provider === "custom" || provider === "grok") &&
    config.openaiUrl
      ? { openaiUrl: config.openaiUrl }
      : {};

  const res = await fetchWithTimeout("/api/proxy-ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider,
      apiKey: config.apiKey,
      model,
      system,
      message: userPrompt,
      ...extra,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(extractProxyError(res, text, provider));
  }

  const data = await res.json();
  return typeof data.content === "string" ? String(data.content) : JSON.stringify(data);
}

/**
 * callAITextStream: streams tokens from the AI provider as they arrive.
 *
 * Returns the full accumulated text, and calls `onToken` for each chunk
 * so the caller can update the UI incrementally.
 */
export async function callAITextStream(
  userPrompt: string,
  config: {
    provider: AIProvider;
    apiKey?: string;
    model?: string;
    openaiUrl?: string;
    ollamaUrl?: string;
    system?: string;
  },
  onToken: (token: string) => void,
): Promise<string> {
  const provider = config.provider;
  const model = config.model || DEFAULT_MODELS[provider] || "gpt-4o-mini";
  const system = config.system ?? SYSTEM_PROMPT;
  let fullText = "";

  if (provider === "ollama") {
    const url = config.ollamaUrl ?? "http://localhost:11434";
    const res = await fetchWithTimeout(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Connection: "keep-alive" },
      body: JSON.stringify({
        model,
        stream: true,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPrompt },
        ],
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ollama API error ${res.status}: ${text}`);
    }
    if (!res.body) throw new Error("Ollama returned no body for streaming");

    for await (const chunk of parseSSEStream(res.body)) {
      const content = extractStreamContent(chunk);
      if (content) {
        fullText += content;
        onToken(content);
      }
    }
    return fullText;
  }

  // Proxy-based providers (OpenAI, Anthropic, Gemini, DeepSeek, etc.)
  if (!config.apiKey) throw new Error(`${provider} requires apiKey in config`);
  const group = getProviderGroup(provider);
  const extra =
    group === "PROXY_API_KEY" &&
    (provider === "openai" || provider === "custom" || provider === "grok") &&
    config.openaiUrl
      ? { openaiUrl: config.openaiUrl }
      : {};

  const res = await fetchWithTimeout("/api/proxy-ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider,
      apiKey: config.apiKey,
      model,
      system,
      message: userPrompt,
      stream: true,
      ...extra,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(extractProxyError(res, text, provider));
  }

  if (!res.body) throw new Error(`${provider} returned no body for streaming`);

  for await (const chunk of parseSSEStream(res.body)) {
    const content = extractStreamContent(chunk);
    if (content) {
      fullText += content;
      onToken(content);
    }
  }

  return fullText;
}

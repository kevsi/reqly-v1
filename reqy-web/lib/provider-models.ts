import { proxyAuthHeaders } from "@/lib/proxy-auth"
import type { AIProvider } from "@/lib/types"
import { isTauriAvailable } from "@/lib/tauri"
import { fetchModelsTauri } from "@/lib/tauri-ai"

export interface ModelOption {
  id: string
  label: string
}

/**
 * Providers whose model list cannot be fetched dynamically
 * (no public endpoint or API doesn't support listing).
 */
export const ANTHROPIC_NO_FETCH = new Set<AIProvider>(["anthropic"])

/**
 * Static fallback model lists for providers that don't expose
 * a public model listing endpoint (anthropic).
 * Also used as initial suggestions before fetching.
 */
export const STATIC_MODELS: Record<string, ModelOption[]> = {
  openrouter: [
    { id: "qwen/qwen3-coder", label: "Qwen3 Coder" },
    { id: "deepseek/deepseek-chat-v3-0324", label: "DeepSeek V3" },
    { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B" },
    { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  ],
  anthropic: [
    { id: "claude-opus-4-5", label: "Claude Opus 4.5" },
    { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  ],
  gemini: [
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
  ],
  openai: [
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "gpt-4o-mini", label: "GPT-4o Mini" },
    { id: "gpt-4-turbo", label: "GPT-4 Turbo" },
  ],
  deepseek: [
    { id: "deepseek-chat", label: "DeepSeek Chat" },
    { id: "deepseek-coder", label: "DeepSeek Coder" },
    { id: "deepseek-reasoner", label: "DeepSeek Reasoner" },
  ],
  ollama: [
    { id: "llama3.2", label: "Llama 3.2" },
    { id: "qwen2.5-coder", label: "Qwen2.5 Coder" },
    { id: "phi3", label: "Phi-3" },
  ],
  "opencode-zen": [],
  custom: [],
}

interface FetchModelsParams {
  provider: AIProvider
  apiKey: string
  baseUrl: string
  isCustom: boolean
}

/**
 * Fetch available models for a provider via the server-side
 * proxy endpoint. The server handles the actual API call, so
 * the user's API key never leaves the server for external requests.
 */
async function proxyFetchModels(
  provider: AIProvider,
  apiKey: string,
  baseUrl: string,
): Promise<ModelOption[]> {
  if (isTauriAvailable()) {
    return fetchModelsTauri(provider, apiKey, baseUrl)
  }

  const body: Record<string, string> = { provider }
  if (apiKey) body.apiKey = apiKey
  if (baseUrl) body.baseUrl = baseUrl

  const res = await fetch("/api/proxy-models", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...proxyAuthHeaders(),
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    throw new Error(err.error ?? `HTTP ${res.status}`)
  }

  const json = (await res.json()) as {
    data?: Array<{ id: string; name?: string; owned_by?: string }>
  }

  const result = (json.data ?? [])
    .filter((m) => typeof m.id === "string")
    .map((m) => ({ id: m.id, label: m.name ?? m.id }))

  if (result.length === 0) throw new Error("Empty list")
  return result
}

export async function fetchModelsByProvider(params: FetchModelsParams): Promise<ModelOption[]> {
  return proxyFetchModels(params.provider, params.apiKey, params.baseUrl)
}

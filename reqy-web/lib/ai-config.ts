import { loadAIProvider, loadApiKey, loadAiModel, loadOllamaConfig } from "@/lib/config";
import type { AIProvider } from "@/lib/types";
import type { AiProxyPayload } from "@/lib/ai-request-generator";

export const DEFAULT_MODELS: Record<AIProvider, string> = {
  anthropic: "claude-sonnet-4-20250514",
  openai: "gpt-4o",
  openrouter: "openai/gpt-5.2",
  gemini: "gemini-2.0-flash",
  deepseek: "deepseek-chat",
  ollama: "llama3",
  "opencode-zen": "gpt-5",
  custom: "gpt-4o-mini",
  grok: "grok-2",
  jina: "jina-embeddings-v3",
};

export function isAiConfigured(): boolean {
  const provider = loadAIProvider();
  if (provider === "ollama") return true;
  return loadApiKey(provider).trim().length > 0;
}

export function buildAiProxyPayload(system: string, message: string): AiProxyPayload | null {
  const provider = loadAIProvider();
  const apiKey = loadApiKey(provider);
  if (provider !== "ollama" && !apiKey.trim()) return null;

  const ollama = loadOllamaConfig();
  // Prefer the user-configured model; fall back to the hard-coded default.
  const configuredModel = loadAiModel(provider);
  const model = configuredModel.trim()
    ? configuredModel.trim()
    : provider === "ollama"
      ? ollama.model || DEFAULT_MODELS.ollama
      : DEFAULT_MODELS[provider];
  return {
    provider,
    apiKey,
    model,
    host: ollama.host,
    port: ollama.port,
    system,
    message,
  };
}

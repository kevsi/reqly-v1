import { secureKeys } from "@/lib/secure-storage";
import { persistence } from "@/lib/persistence";
import type {
  AIProvider,
  OllamaConfig,
  GithubConfig,
  HttpMethod,
  AnalysisMode,
  SavedProject,
} from "@/lib/types";
import type { DetectedRoute } from "@/lib/detect-shared";

export type { AIProvider, HttpMethod, AnalysisMode, SavedProject, DetectedRoute };

const API_KEYS_KEY = "probe_api_keys";
const AI_PROVIDER_KEY = "probe_ai_provider";
const AI_BASE_URL_KEY = "probe_ai_base_urls";
const AI_MODEL_KEY = "probe_ai_models";
const OLLAMA_CONFIG_KEY = "probe_ollama_config";
const GITHUB_CONFIG_KEY = "probe_github_config";

export function loadApiKey(provider: AIProvider): string {
  return secureKeys.get(`${API_KEYS_KEY}_${provider}`) ?? "";
}

export function saveApiKey(provider: AIProvider, key: string) {
  if (key) {
    secureKeys.set(`${API_KEYS_KEY}_${provider}`, key);
  } else {
    secureKeys.delete(`${API_KEYS_KEY}_${provider}`);
  }
}

export function loadAIProvider(): AIProvider {
  try {
    const raw = persistence.getItem<string>(AI_PROVIDER_KEY);
    if (!raw) return "openai";
    return raw as AIProvider;
  } catch {
    return "openai";
  }
}

export async function saveAIProvider(provider: AIProvider) {
  try {
    await persistence.setItem(AI_PROVIDER_KEY, provider);
  } catch {
    // Persistence is best-effort; keep the in-memory configuration usable.
  }
}

export function loadAiBaseUrl(provider: AIProvider): string {
  try {
    const raw = persistence.getItem<Record<string, string>>(AI_BASE_URL_KEY);
    if (!raw) return "";
    return raw[provider] ?? "";
  } catch {
    return "";
  }
}

export async function saveAiBaseUrl(provider: AIProvider, url: string) {
  try {
    const urls = persistence.getItem<Record<string, string>>(AI_BASE_URL_KEY) || {};
    urls[provider] = url;
    await persistence.setItem(AI_BASE_URL_KEY, urls);
  } catch {
    // Persistence is best-effort; keep the in-memory configuration usable.
  }
}

export function loadAiModel(provider: AIProvider): string {
  try {
    const raw = persistence.getItem<Record<string, string>>(AI_MODEL_KEY);
    if (!raw) return "";
    return raw[provider] ?? "";
  } catch {
    return "";
  }
}

export async function saveAiModel(provider: AIProvider, model: string) {
  try {
    const models = persistence.getItem<Record<string, string>>(AI_MODEL_KEY) || {};
    models[provider] = model;
    await persistence.setItem(AI_MODEL_KEY, models);
  } catch {
    // Persistence is best-effort; keep the in-memory configuration usable.
  }
}

export function loadOllamaConfig(): OllamaConfig {
  try {
    return persistence.getItem<OllamaConfig>(OLLAMA_CONFIG_KEY) || {};
  } catch {
    return {};
  }
}

export async function saveOllamaConfig(config: OllamaConfig) {
  try {
    await persistence.setItem(OLLAMA_CONFIG_KEY, config);
  } catch {
    // Persistence is best-effort; keep the in-memory configuration usable.
  }
}

export function loadGithubConfig(): GithubConfig {
  const token = secureKeys.get(GITHUB_CONFIG_KEY);
  return token ? { token } : {};
}

export function saveGithubConfig(config: GithubConfig) {
  if (config.token) {
    secureKeys.set(GITHUB_CONFIG_KEY, config.token);
  } else {
    secureKeys.delete(GITHUB_CONFIG_KEY);
  }
}

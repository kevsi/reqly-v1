"use client";

import { useCallback, useState } from "react";
import {
  AIContext,
  AIResponse,
  CurrentRequest,
  LastResponse,
  TestAssertion,
  ACTIONS_SYSTEM_PROMPT,
  dispatchAIActions,
  parseAIResponse,
  PROMPTS,
  AIProvider,
} from "@/src/ai/cloud-engine/actions";
import { buildSearchText, searchIndex } from "@/src/ai/cloud-engine/search-index";
import { callAITextViaStream } from "@/src/ai/cloud-engine/text";
import { DEFAULT_MODELS } from "@/lib/ai-config";
import {
  loadAIProvider,
  loadApiKey,
  loadOllamaConfig,
  loadAiBaseUrl,
  loadAiModel,
} from "@/lib/config";
import { useRequestStore } from "@/hooks/use-request-store";

export interface AIConfig {
  provider: AIProvider;
  apiKey?: string;
  model?: string;
  openaiUrl?: string;
  ollamaUrl?: string;
  /** Host/port Ollama dérivés de loadOllamaConfig par parseAiConfig. */
  host?: string;
  port?: number;
}

interface AIRequestStore {
  currentRequest?: CurrentRequest | null;
  lastResponse?: LastResponse | null;
  environmentVariables?: Record<string, string>;
  collectionHistory?: CurrentRequest[];
  activeCollection?: string | null;
  patchRequest: (patch: Partial<CurrentRequest>) => void;
  addAssertions: (assertions: TestAssertion[]) => void;
  setVariable: (name: string, value: string, description?: string) => void;
  setDoc: (markdown: string, title?: string) => void;
  notify?: (message: string) => void;
  addNotification: (notif: {
    title: string;
    body?: string;
    type?: "info" | "success" | "warning" | "error";
    event?: string;
  }) => void;
  aiAutoApply?: boolean;
  // Pont volontairement non typé : le store expose `RequestItem` alors que les
  // actions IA manipulent `CurrentRequest` (shapes incompatibles). Unifier les
  // deux modèles de requête permettrait de supprimer ce `any`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  executeRequest?: (request: any) => Promise<any>;
  addAiAuditEntry?: (entry: { actionType: string; detail?: unknown; result?: unknown }) => unknown;
}

export interface UseAIEngineResult {
  isLoading: boolean;
  lastSummary: string | null;
  error: string | null;
  analyzeAfterRequest: (ctx: AIContext) => Promise<void>;
  generateTests: (ctx: AIContext) => Promise<void>;
  askNaturalLanguage: (description: string, ctx: AIContext) => Promise<void>;
  generateDocs: (requests: CurrentRequest[]) => Promise<void>;
  sendMessage: (
    message: string,
    systemPrompt: string,
    ctx: AIContext,
    configOverride?: Partial<AIConfig>,
  ) => Promise<string>;
  buildContext: () => AIContext;
}

function parseAiConfig(override?: Partial<AIConfig>): AIConfig {
  const provider = override?.provider ?? loadAIProvider();
  const apiKey = override?.apiKey ?? loadApiKey(provider) ?? "";
  const openaiUrl = override?.openaiUrl ?? loadAiBaseUrl(provider);
  const modelOverride = override?.model ?? loadAiModel(provider);
  const ollamaConfig = loadOllamaConfig();

  if (!provider) {
    throw new Error("Configure ton provider IA dans Settings");
  }

  if (provider !== "ollama" && !apiKey.trim()) {
    throw new Error("Clé API manquante dans Settings");
  }

  return {
    provider,
    apiKey: apiKey.trim(),
    model:
      modelOverride?.trim() ||
      (provider === "ollama" ? ollamaConfig.model : undefined) ||
      DEFAULT_MODELS[provider],
    openaiUrl:
      provider === "openai" || provider === "custom" || provider === "grok"
        ? openaiUrl?.trim() || undefined
        : undefined,
    ollamaUrl:
      provider === "ollama"
        ? `http://${ollamaConfig.host || "127.0.0.1"}:${ollamaConfig.port ?? 11434}`
        : undefined,
    host: provider === "ollama" ? ollamaConfig.host || "127.0.0.1" : undefined,
    port: provider === "ollama" ? (ollamaConfig.port ?? 11434) : undefined,
  };
}

function getHandlers(store: AIRequestStore) {
  return {
    setRequest: (patch: Partial<CurrentRequest>) => store.patchRequest(patch),
    addAssertions: (assertions: TestAssertion[]) => store.addAssertions(assertions),
    setVariable: (name: string, value: string, description?: string) =>
      store.setVariable(name, value, description),
    applyFix: (patch: Partial<CurrentRequest>) => store.patchRequest(patch),
    setDoc: (markdown: string, title?: string) => store.setDoc(markdown, title),
    notify: (message: string) =>
      store.addNotification
        ? store.addNotification({ title: "Assistant IA", body: String(message), type: "info" })
        : undefined,
    executeRequest: (request: Partial<CurrentRequest> | CurrentRequest) =>
      store.executeRequest ? store.executeRequest(request) : undefined,
    runBatch: async (requests: Array<Partial<CurrentRequest>>) => {
      const results: unknown[] = [];
      for (const req of requests) {
        if (store.executeRequest) {
          const res = await store.executeRequest(req);
          results.push(res);
        }
      }
      return results;
    },
    audit: (entry: { actionType: string; detail?: unknown; result?: unknown }) => {
      if (!store.addAiAuditEntry) return;
      store.addAiAuditEntry(entry);
    },
  };
}

export interface AIEngineHandlers {
  setRequest?: (patch: Partial<CurrentRequest>, reason?: string) => void | Promise<void>;
  addAssertions?: (assertions: TestAssertion[], autoApply?: boolean) => void | Promise<void>;
  setVariable?: (name: string, value: string, description?: string) => void | Promise<void>;
  applyFix?: (patch: Partial<CurrentRequest>) => void | Promise<void>;
  setDoc?: (markdown: string, title?: string) => void | Promise<void>;
  notify?: (message: string) => void | Promise<void>;
  executeRequest?: (request: Partial<CurrentRequest> | CurrentRequest) => Promise<unknown> | void;
  runBatch?: (requests: Array<Partial<CurrentRequest>>) => Promise<unknown[]> | void;
  audit?: (entry: {
    actionType: string;
    detail?: unknown;
    result?: unknown;
  }) => void | Promise<void>;
}

function mergeHandlers(store: AIRequestStore, overrides?: AIEngineHandlers) {
  const base = getHandlers(store);
  if (!overrides) return base;
  return {
    ...base,
    ...overrides,
    setRequest: overrides.setRequest ?? base.setRequest,
    addAssertions: overrides.addAssertions ?? base.addAssertions,
    setVariable: overrides.setVariable ?? base.setVariable,
    applyFix: overrides.applyFix ?? base.applyFix,
    setDoc: overrides.setDoc ?? base.setDoc,
    notify: overrides.notify ?? base.notify,
    executeRequest: overrides.executeRequest ?? base.executeRequest,
    runBatch: overrides.runBatch ?? base.runBatch,
    audit: overrides.audit ?? base.audit,
  };
}

export function useAIEngine(handlerOverrides?: AIEngineHandlers): UseAIEngineResult {
  const store = useRequestStore();
  const [isLoading, setIsLoading] = useState(false);
  const [lastSummary, setLastSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const buildContext = useCallback((): AIContext => {
    return {
      currentRequest: store.currentRequest ?? {
        method: "GET",
        url: "",
        headers: {},
        params: {},
      },
      lastResponse: store.lastResponse ?? null,
      environmentVariables: store.environmentVariables ?? {},
      collectionHistory: (store.collectionHistory ?? []).slice(0, 10),
      activeCollection: store.activeCollection ?? null,
    };
  }, [store]);

  const runAiCall = useCallback(
    async (prompt: string, ctx: AIContext): Promise<AIResponse> => {
      const config = parseAiConfig();
      // Étape 4 : transport migré vers le cloud-engine (streamLLM via le proxy),
      // mais le contrat legacy est préservé à l'identique — SYSTEM_PROMPT
      // JSON-actions legacy, parseAIResponse et dispatchAIActions (gate
      // allowAutoApply intacte). L'équivalent exact de l'ancien `callAI`.
      const text = await callAITextViaStream({
        provider: config.provider,
        apiKey: config.apiKey ?? "",
        model: config.model,
        openaiUrl: config.openaiUrl,
        host: config.host,
        port: config.port,
        system: ACTIONS_SYSTEM_PROMPT,
        rawMessage: prompt,
      });
      const aiRes = parseAIResponse(text);
      await dispatchAIActions(aiRes.actions, mergeHandlers(store, handlerOverrides), ctx, {
        allowAutoApply: Boolean(store.aiAutoApply),
      });
      return aiRes;
    },
    [store, handlerOverrides],
  );

  const analyzeAfterRequest = useCallback(
    async (ctx: AIContext): Promise<void> => {
      setError(null);
      setIsLoading(true);
      try {
        const query = buildSearchText(
          ctx.currentRequest.method,
          ctx.currentRequest.url ?? "",
          (ctx.currentRequest.body as string | undefined) ?? "",
        );
        const results = await searchIndex(query, 5);
        const retrievedChunks = results.map((r) => ({
          source: `${r.item.collectionName} · ${r.item.method} ${r.item.url}`,
          content: r.item.text,
          score: r.score,
          origin: "historical-requests",
        }));
        const analyzeRes = await runAiCall(PROMPTS.analyzeResponse(ctx, retrievedChunks), ctx);
        setLastSummary(analyzeRes.summary);

        if (ctx.lastResponse && ctx.lastResponse.status >= 400) {
          const debugRes = await runAiCall(PROMPTS.debugError(ctx), ctx);
          setLastSummary(debugRes.summary);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        store.addNotification?.({ title: "Erreur IA", body: String(message), type: "error" });
      } finally {
        setIsLoading(false);
      }
    },
    [runAiCall, store],
  );

  const generateTests = useCallback(
    async (ctx: AIContext): Promise<void> => {
      setError(null);
      setIsLoading(true);
      try {
        const aiRes = await runAiCall(PROMPTS.generateTests(ctx), ctx);
        setLastSummary(aiRes.summary);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        store.addNotification?.({ title: "Erreur IA", body: String(message), type: "error" });
      } finally {
        setIsLoading(false);
      }
    },
    [runAiCall, store],
  );

  const askNaturalLanguage = useCallback(
    async (description: string, ctx: AIContext): Promise<void> => {
      setError(null);
      setIsLoading(true);
      try {
        const aiRes = await runAiCall(PROMPTS.naturalLanguageToRequest(description, ctx), ctx);
        setLastSummary(aiRes.summary);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        store.notify?.(`Erreur IA: ${message}`);
      } finally {
        setIsLoading(false);
      }
    },
    [runAiCall, store],
  );

  const sendMessage = useCallback(
    async (
      message: string,
      systemPrompt: string,
      ctx: AIContext,
      configOverride?: Partial<AIConfig>,
    ): Promise<string> => {
      setError(null);
      setIsLoading(true);
      try {
        const config = parseAiConfig(configOverride);
        const text = await callAITextViaStream({
          provider: config.provider,
          apiKey: config.apiKey ?? "",
          model: config.model,
          openaiUrl: config.openaiUrl,
          host: config.host,
          port: config.port,
          system: systemPrompt,
          rawMessage: message,
        });
        return text;
      } catch (err) {
        const messageText = err instanceof Error ? err.message : String(err);
        setError(messageText);
        store.addNotification?.({ title: "Erreur IA", body: String(messageText), type: "error" });
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [store],
  );

  const generateDocs = useCallback(
    async (requests: CurrentRequest[]): Promise<void> => {
      setError(null);
      setIsLoading(true);
      try {
        const ctx = buildContext();
        const aiRes = await runAiCall(PROMPTS.generateDocs(requests), ctx);
        setLastSummary(aiRes.summary);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        store.addNotification?.({ title: "Erreur IA", body: String(message), type: "error" });
      } finally {
        setIsLoading(false);
      }
    },
    [buildContext, runAiCall, store],
  );

  return {
    isLoading,
    lastSummary,
    error,
    analyzeAfterRequest,
    generateTests,
    askNaturalLanguage,
    generateDocs,
    sendMessage,
    buildContext,
  };
}

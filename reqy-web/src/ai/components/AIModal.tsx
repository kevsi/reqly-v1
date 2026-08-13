"use client";

/**
 * Phase 2.7+ — AI Modal (unified AI panel for the response area)
 *
 * Single-button entry point that opens a modal with page-dedicated AI
 * features. Tabs: Analyse | Debug | Tests | Explain | Generate | Optimize.
 *
 * Replaces the previous multi-tab AI layout (Chat + ReqlyAI).
 */
import { useMemo, useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Bot, Loader2, Sparkles, Clipboard, FileText, Lightbulb, Key } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { analyze } from "@/src/ai/local-engine/analyzer";
import { buildRequestContext } from "@/src/ai/local-engine/context";
import { Panel } from "./Panel";
import { searchIndex, buildSearchText } from "@/src/ai/cloud-engine/search-index";
import type { Diagnostic, RequestPayload, AIProvider } from "@/src/ai/types";
import { buildTestSuggestionsPrompt } from "@/src/ai/cloud-engine/test-suggestions";
import {
  decodeJwt,
  explainHeader,
  annotateJson,
  summarizeAnnotated,
} from "@/src/ai/cloud-engine/explain";

import { streamLLM, type StreamLLMOptions } from "@/src/ai/cloud-engine/llm";
import { type RetrievedChunk } from "@/src/ai/cloud-engine/prompt";
import { extractCitations } from "@/src/ai/cloud-engine/citations";
import { detectLanguage } from "@/src/ai/cloud-engine/language";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { isAiConfigured } from "@/lib/ai-config";
import {
  loadAIProvider,
  loadApiKey,
  loadAiModel,
  loadAiBaseUrl,
  loadOllamaConfig,
  saveAIProvider,
  saveApiKey,
} from "@/lib/config";
import { REQLY_TOOLS, executeToolCall, maskSensitiveObject } from "@/lib/llm-tools";
import type { ToolCall, ToolResult } from "@/lib/llm-tools";
import {
  AssistantStepsRenderer,
  buildStep,
  type AssistantStep,
} from "@/src/ai/components/assistant-steps-renderer";
import { AiMarkdown } from "@/src/ai/components/ai-markdown";

type AiTab = "analyse" | "assistant" | "explain";

/** Messages d'erreur typiques quand le provider IA ne supporte pas les tools/function calling. */
function isToolUnsupportedError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes("tools") ||
    lower.includes("functions") ||
    lower.includes("function calling") ||
    lower.includes("tool_calls") ||
    lower.includes("unrecognized") ||
    lower.includes("upstream request failed") ||
    lower.includes("not supported") ||
    lower.includes("not available") ||
    lower.includes("invalid parameter") ||
    lower.includes("unknown parameter")
  );
}

export interface AIModalContext {
  method: string;
  url: string;
  requestHeaders?: Array<{ key: string; value: string }>;
  requestBody?: string;
  responseStatus?: number;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  authToken?: string;
  onPatchRequest?: (patch: Partial<RequestPayload>) => void;
}

interface AIModalProps extends AIModalContext {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const TABS: Array<{ id: AiTab; label: string; icon: typeof Sparkles; desc: string }> = [
  {
    id: "analyse",
    label: "Analyse",
    icon: Sparkles,
    desc: "Diagnostic local instantané — repère les problèmes courants (auth manquante, CORS, etc.)",
  },
  {
    id: "assistant",
    label: "Assistant",
    icon: Bot,
    desc: "Génère des tests, débugge les erreurs, optimise les appels, ou répond à tes questions",
  },
  {
    id: "explain",
    label: "Explain",
    icon: FileText,
    desc: "Décode les headers JWT, explique la structure JSON et les en-têtes de réponse",
  },
];

export function AIModal(props: AIModalProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<AiTab>("analyse");
  const [userPrompt, setUserPrompt] = useState("");
  const [llmOutput, setLlmOutput] = useState("");
  const [llmLoading, setLlmLoading] = useState(false);
  const [llmError, setLlmError] = useState<string | null>(null);
  const [steps, setSteps] = useState<AssistantStep[]>([]);
  const [pendingConfirmation, setPendingConfirmation] = useState<{
    stepId: string;
    toolCall: { callId: string; name: string; arguments: string };
    toolCallsThisTurn: Array<{ callId: string; name: string; arguments: string }>;
    results: ToolResult[];
    turnSteps: AssistantStep[];
    reasoningContent?: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  // Refs pour la boucle multi-turn — persistentes entre handleRunLLM et handleConfirmToolCall
  const accRef = useRef("");
  const previousTurnsRef = useRef<
    Array<{
      assistantToolCalls: ToolCall[];
      toolResults: ToolResult[];
      reasoningContent?: string;
    }>
  >([]);
  const turnCountRef = useRef(0);
  const baseOptsRef = useRef<Omit<StreamLLMOptions, "previousTurns"> | null>(null);
  /** Flag pour éviter une boucle infinie si le provider ne supporte pas les outils. */
  const retriedWithoutToolsRef = useRef(false);
  const MAX_TOOL_TURNS = 5;

  // Inline AI config state (shown when no API key is set)
  const [showConfig, setShowConfig] = useState(false);
  const [configProvider, setConfigProvider] = useState<string>("openai");
  const [configApiKey, setConfigApiKey] = useState("");

  // Build the RequestContext once per modal render
  const ctx = useMemo(() => {
    const headerRecord: Record<string, string> = {};
    for (const h of props.requestHeaders ?? []) {
      if (h.key) headerRecord[h.key] = h.value;
    }
    return buildRequestContext(
      {
        method: props.method as RequestPayload["method"],
        url: props.url ?? "",
        headers: headerRecord,
        body: props.requestBody ?? null,
        authType: "none",
      },
      props.responseStatus !== undefined
        ? {
            status: props.responseStatus,
            statusText: "",
            headers: props.responseHeaders ?? {},
            body: props.responseBody,
            duration: 0,
            size: 0,
          }
        : undefined,
    );
  }, [
    props.method,
    props.url,
    props.requestHeaders,
    props.requestBody,
    props.responseStatus,
    props.responseHeaders,
    props.responseBody,
  ]);

  const diagnostics = useMemo(() => analyze(ctx), [ctx]);

  const prompt = useMemo(() => {
    switch (activeTab) {
      case "analyse":
        return `Analyse cette requête/réponse HTTP et liste les problèmes potentiels.\n\nMéthode: ${props.method}\nURL: ${props.url}\nStatus: ${props.responseStatus ?? "inconnu"}\n\nRéponse (extrait):\n${(props.responseBody ?? "").slice(0, 1000)}`;
      case "assistant": {
        const hasError = props.responseStatus != null && props.responseStatus >= 400;
        return hasError
          ? `Debug cette réponse HTTP. Si le status indique une erreur (4xx/5xx), explique la cause probable et propose un fix concret.\n\n${props.method} ${props.url}\nStatus: ${props.responseStatus}\n\nBody:\n${(props.responseBody ?? "").slice(0, 2000)}`
          : buildTestSuggestionsPrompt({
              method: props.method,
              url: props.url,
              headers: props.responseHeaders,
              body: props.requestBody,
              lastStatus: props.responseStatus,
            });
      }
      case "explain":
        return `Explique les headers et le body de cette réponse de manière pédagogique. Si le body contient du JSON, annote la structure. Si un header Authorization est présent, décode le JWT.\n\n${props.method} ${props.url}\nStatus: ${props.responseStatus}\n\nHeaders: ${JSON.stringify(props.responseHeaders ?? {}, null, 2)}\n\nBody (extrait):\n${(props.responseBody ?? "").slice(0, 2000)}`;
      default:
        return "";
    }
  }, [activeTab, props]);

  const citations = useMemo(() => {
    if (props.responseStatus && props.responseStatus >= 400) return [];
    return extractCitations([
      {
        source: "request-context",
        content: `${props.method} ${props.url}\n${(props.responseBody ?? "").slice(0, 500)}`,
        metadata: { source: "current-request" },
        score: 1,
      },
    ]);
  }, [props.method, props.url, props.responseBody, props.responseStatus]);

  const lang = useMemo(() => detectLanguage(prompt), [prompt]);
  const langDirective = lang === "en" ? "\n\nRespond in English." : "";

  const handleSaveConfig = useCallback(() => {
    if (!configApiKey.trim()) {
      toast.error("Veuillez entrer une clé API");
      return;
    }
    saveAIProvider(configProvider as AIProvider);
    saveApiKey(configProvider as AIProvider, configApiKey.trim());
    toast.success("Clé API enregistrée");
    setShowConfig(false);
  }, [configProvider, configApiKey]);

  const runOneTurn = useCallback(async function runOneTurn() {
    if (!baseOptsRef.current) return;
    const turnNum = turnCountRef.current;
    if (turnNum >= MAX_TOOL_TURNS) {
      setLlmError(
        "L'assistant a atteint la limite de 5 tours d'outils. Certaines actions peuvent être incomplètes.",
      );
      setLlmLoading(false);
      return;
    }

    const opts: StreamLLMOptions = {
      ...baseOptsRef.current,
      previousTurns:
        previousTurnsRef.current.length > 0 ? [...previousTurnsRef.current] : undefined,
    };

    const stream = streamLLM(opts);
    const toolCallsThisTurn: Array<{ callId: string; name: string; arguments: string }> = [];
    // `reasoning_content` du tour (DeepSeek thinking mode) — renvoyé dans
    // l'historique du tour suivant, obligatoire sinon HTTP 400.
    let reasoningThisTurn = "";

    try {
      for await (const token of stream) {
        if (token.type === "text") {
          accRef.current += token.value;
          setLlmOutput(accRef.current);
        } else if (token.type === "tool_calls") {
          reasoningThisTurn += token.reasoningContent ?? "";
          toolCallsThisTurn.push(
            ...token.calls.map((c) => ({ callId: c.id, name: c.name, arguments: c.arguments })),
          );
        }
      }
    } catch (e) {
      // Si l'erreur ressemble à un rejet des tools/function calling et
      // qu'on n'a pas déjà retenté, on relance sans outils.
      if (
        baseOptsRef.current?.tools &&
        !retriedWithoutToolsRef.current &&
        isToolUnsupportedError(e instanceof Error ? e.message : typeof e === "string" ? e : "")
      ) {
        retriedWithoutToolsRef.current = true;
        baseOptsRef.current = { ...baseOptsRef.current, tools: undefined, tool_choice: undefined };
        // Reset output pour ce nouvel essai
        setLlmOutput("");
        setLlmError(null);
        runOneTurn(); // retry sans tools
        return;
      }
      setLlmError(
        e instanceof Error
          ? e.message
          : typeof e === "string"
            ? e
            : "Erreur de communication avec l'IA",
      );
      setLlmLoading(false);
      return;
    }

    // Plus d'outils → terminé
    if (toolCallsThisTurn.length === 0) {
      setLlmLoading(false);
      return;
    }

    // Créer les étapes "en attente"
    const turnSteps: AssistantStep[] = toolCallsThisTurn.map((tc) => {
      let safeArgs: Record<string, unknown> = {};
      try {
        safeArgs = JSON.parse(tc.arguments);
      } catch {
        /* ignore */
      }
      const masked = maskSensitiveObject(safeArgs);
      return buildStep({
        kind: "tool_call",
        label: `${tc.name}(${JSON.stringify(masked)})`,
        status: "pending",
      });
    });
    setSteps((prev) => [...prev, ...turnSteps]);

    // Exécuter les tools séquentiellement
    const results: ToolResult[] = [];
    for (let i = 0; i < toolCallsThisTurn.length; i++) {
      const tc = toolCallsThisTurn[i];
      try {
        const result = await executeToolCall({
          id: tc.callId,
          name: tc.name,
          arguments: tc.arguments,
        });
        results.push(result);
        setSteps((prev) =>
          prev.map((s) =>
            s.id === turnSteps[i]?.id
              ? { ...s, status: result.error ? ("error" as const) : ("done" as const) }
              : s,
          ),
        );
      } catch (e) {
        results.push({
          callId: tc.callId,
          name: tc.name,
          content: "",
          error: e instanceof Error ? e.message : typeof e === "string" ? e : "Erreur inconnue",
        });
        setSteps((prev) =>
          prev.map((s) => (s.id === turnSteps[i]?.id ? { ...s, status: "error" as const } : s)),
        );
      }
    }

    // requireConfirmation → suspendre
    const confirmIdx = results.findIndex((r) => r.requireConfirmation);
    if (confirmIdx !== -1 && confirmIdx < toolCallsThisTurn.length) {
      const targetStepId = turnSteps[confirmIdx]?.id;
      const targetTc = toolCallsThisTurn[confirmIdx];
      setSteps((prev) =>
        prev.map((s) =>
          s.id === targetStepId
            ? {
                ...s,
                status: "awaiting_confirmation" as const,
                label: `⚠ ${targetTc.name} — confirmation requise`,
              }
            : s,
        ),
      );
      setPendingConfirmation({
        stepId: targetStepId,
        toolCall: { callId: targetTc.callId, name: targetTc.name, arguments: targetTc.arguments },
        toolCallsThisTurn,
        results,
        turnSteps,
        ...(reasoningThisTurn ? { reasoningContent: reasoningThisTurn } : {}),
      });
      setLlmLoading(false);
      return;
    }

    // Stocker ce tour et continuer
    previousTurnsRef.current = [
      ...previousTurnsRef.current,
      {
        assistantToolCalls: toolCallsThisTurn.map((tc) => ({
          id: tc.callId,
          name: tc.name,
          arguments: tc.arguments,
        })),
        toolResults: results,
        ...(reasoningThisTurn ? { reasoningContent: reasoningThisTurn } : {}),
      },
    ];
    turnCountRef.current = turnNum + 1;

    // Limite de tours atteinte
    if (turnCountRef.current >= MAX_TOOL_TURNS) {
      setLlmLoading(false);
      setLlmError("L'IA a atteint le nombre maximal de tours autorisés.");
      return;
    }

    // Prochain tour
    runOneTurn();
  }, []);

  const handleConfirmToolCall = useCallback(
    async (stepId: string, confirmed: boolean) => {
      const pending = pendingConfirmation;
      if (!pending || pending.stepId !== stepId) return;

      const { toolCall, toolCallsThisTurn, results, reasoningContent } = pending;
      setPendingConfirmation(null);

      // Marquer l'étape "en cours" pendant la ré-exécution
      setSteps((prev) =>
        prev.map((s) => (s.id === stepId ? { ...s, status: "pending" as const } : s)),
      );

      try {
        const result = await executeToolCall(
          { id: toolCall.callId, name: toolCall.name, arguments: toolCall.arguments },
          confirmed,
        );

        // Vérifier result.error après exécution confirmée
        const hasError = !confirmed ? false : !!result.error;
        setSteps((prev) =>
          prev.map((s) =>
            s.id === stepId
              ? {
                  ...s,
                  status: hasError ? ("error" as const) : ("done" as const),
                  label: confirmed
                    ? hasError
                      ? `❌ ${toolCall.name} : ${result.error}`
                      : `✅ ${toolCall.name}`
                    : `⛔ ${toolCall.name} (annulé)`,
                }
              : s,
          ),
        );

        // Si annulé, propager error: "Action annulée par l'utilisateur"
        const finalResult: ToolResult = confirmed
          ? result
          : {
              callId: toolCall.callId,
              name: toolCall.name,
              content: "",
              error: "Action annulée par l'utilisateur",
            };

        // Remplacer le placeholder requireConfirmation par le vrai résultat
        const updatedResults = results.map((r) => (r.requireConfirmation ? finalResult : r));

        // Pousser ce tour dans l'historique
        previousTurnsRef.current = [
          ...previousTurnsRef.current,
          {
            assistantToolCalls: toolCallsThisTurn.map((tc) => ({
              id: tc.callId,
              name: tc.name,
              arguments: tc.arguments,
            })),
            toolResults: updatedResults,
            ...(reasoningContent ? { reasoningContent } : {}),
          },
        ];
        turnCountRef.current += 1;

        // Limite de tours atteinte
        if (turnCountRef.current >= MAX_TOOL_TURNS) {
          setLlmLoading(false);
          setLlmError("L'IA a atteint le nombre maximal de tours autorisés.");
          return;
        }

        // Reprendre la boucle multi-turn
        runOneTurn();
      } catch (e) {
        setSteps((prev) =>
          prev.map((s) => (s.id === stepId ? { ...s, status: "error" as const } : s)),
        );
        setLlmError(
          e instanceof Error
            ? e.message
            : typeof e === "string"
              ? e
              : "Erreur lors de la confirmation",
        );
        setLlmLoading(false);
      }
    },
    [pendingConfirmation, runOneTurn],
  );

  async function handleRunLLM() {
    if (!prompt) return;

    // Check AI config — if missing, show config form instead
    const provider = loadAIProvider();
    const apiKey = loadApiKey(provider);
    if (!isAiConfigured()) {
      setConfigProvider(provider);
      setConfigApiKey("");
      setShowConfig(true);
      return;
    }

    const model = loadAiModel(provider);
    const openaiUrl = loadAiBaseUrl(provider);
    const ollamaConfig = loadOllamaConfig();

    // Fetch RAG chunks from similar historical requests
    let retrievedChunks: RetrievedChunk[] = [];
    try {
      const q = buildSearchText(
        props.method,
        props.url ?? "",
        props.url ?? "",
        props.requestBody ?? undefined,
      );
      const ragResults = await searchIndex(q, 5);
      retrievedChunks = ragResults.map((r) => ({
        source: `${r.item.collectionName} · ${r.item.method} ${r.item.url}`,
        content: r.item.text,
        score: r.score,
        origin: "historical-requests",
      }));
    } catch {
      /* RAG unavailable (no Jina key, no indexed requests, etc.) */
    }

    // Initialiser les refs
    accRef.current = "";
    previousTurnsRef.current = [];
    turnCountRef.current = 0;
    retriedWithoutToolsRef.current = false;
    baseOptsRef.current = {
      provider,
      apiKey: apiKey || "",
      model: model,
      openaiUrl: openaiUrl,
      host: ollamaConfig?.host,
      port: ollamaConfig?.port,
      question: userPrompt || prompt,
      ctx,
      diagnostics,
      signal: undefined,
      tools: REQLY_TOOLS,
      tool_choice: "auto",
      retrievedChunks,
    };

    setLlmLoading(true);
    setLlmError(null);
    setLlmOutput("");
    setSteps([]);
    setPendingConfirmation(null);

    try {
      await runOneTurn();
    } catch (e) {
      setLlmError(e instanceof Error ? e.message : typeof e === "string" ? e : "Erreur inconnue");
      setLlmLoading(false);
    }
  }

  function handleCopy() {
    if (!prompt) return;
    navigator.clipboard?.writeText(prompt + langDirective);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const { onPatchRequest: handlePatch } = props;
  const handleApplyFix = useCallback(
    (diag: Diagnostic) => {
      if (!diag.fix) return;
      if (handlePatch) {
        handlePatch(diag.fix.applyFix());
        toast.success(t("ai.modal.fixApplied"), { description: diag.title });
      } else {
        toast.info(t("ai.modal.noPatchTarget"));
      }
    },
    [handlePatch, t],
  );

  const isLocalTab = activeTab === "analyse" || activeTab === "explain";

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="size-4 text-primary" />
            ReqlyAI · Assistant
          </DialogTitle>
          <DialogDescription>
            {props.method} {props.url || "(pas d'URL)"} · Status {props.responseStatus ?? "—"}
          </DialogDescription>
        </DialogHeader>

        {/* Tab bar */}
        <div className="flex gap-1 border-b border-border overflow-x-auto">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                title={t.desc}
                onClick={() => {
                  setActiveTab(t.id);
                  setLlmOutput("");
                  setLlmError(null);
                  setShowConfig(false);
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold uppercase tracking-wider transition-all",
                  active
                    ? "border-b-2 border-primary text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
                data-testid={`ai-tab-${t.id}`}
              >
                <Icon className="size-3" />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Description sous la tab bar */}
        <p className="text-xs text-muted-foreground px-1 -mt-2">
          {TABS.find((t) => t.id === activeTab)?.desc}
        </p>

        {/* Content */}
        <div className="min-h-[260px] max-h-[420px] overflow-y-auto p-1">
          {activeTab === "analyse" && (
            <Panel diagnostics={diagnostics} onApplyFix={handleApplyFix} />
          )}

          {activeTab === "explain" && (
            <ExplainTab
              responseHeaders={props.responseHeaders}
              responseBody={props.responseBody}
              authHeader={Object.entries(props.responseHeaders ?? {}).find(
                ([k]) => k.toLowerCase() === "authorization",
              )}
            />
          )}

          {activeTab === "assistant" && !isLocalTab && (
            <div className="space-y-3">
              {/* Inline config when no API key */}
              {showConfig && (
                <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-warning">
                    <Key className="size-3.5" />
                    Configure ta clé API pour utiliser l'assistant
                  </div>
                  <div className="flex gap-2">
                    <Select value={configProvider} onValueChange={setConfigProvider}>
                      <SelectTrigger className="w-[160px] h-9 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="openai">OpenAI</SelectItem>
                        <SelectItem value="anthropic">Anthropic</SelectItem>
                        <SelectItem value="openrouter">OpenRouter</SelectItem>
                        <SelectItem value="gemini">Gemini</SelectItem>
                        <SelectItem value="deepseek">DeepSeek</SelectItem>
                        <SelectItem value="grok">Grok</SelectItem>
                        <SelectItem value="ollama">Ollama (local)</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      type="password"
                      placeholder="sk-..."
                      value={configApiKey}
                      onChange={(e) => setConfigApiKey(e.target.value)}
                      className="flex-1 h-9 text-xs"
                    />
                    <Button
                      size="sm"
                      variant="default"
                      onClick={handleSaveConfig}
                      className="h-9 shrink-0"
                    >
                      <Key className="size-3 mr-1" />
                      OK
                    </Button>
                  </div>
                </div>
              )}

              {/* Prompt + user input */}
              <div className="flex items-start gap-2">
                <Textarea
                  value={userPrompt}
                  onChange={(e) => setUserPrompt(e.target.value)}
                  placeholder={
                    props.responseStatus != null && props.responseStatus >= 400
                      ? "Explique l'erreur et propose un correctif..."
                      : "Génère des assertions de test, optimise la requête, ou pose une question..."
                  }
                  rows={3}
                  className="resize-none text-sm flex-1 [field-sizing:fixed]"
                  data-testid="ai-assistant-input"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleRunLLM}
                  disabled={llmLoading}
                  className="shrink-0 mt-[5px]"
                  data-testid="ai-run-llm"
                >
                  {llmLoading ? (
                    <>
                      <Loader2 className="size-3 mr-1 animate-spin pointer-events-none" />
                      Génération...
                    </>
                  ) : (
                    <>
                      <Sparkles className="size-3 mr-1 pointer-events-none" />
                      {showConfig ? "Configurer d'abord" : "Lancer l'assistant"}
                    </>
                  )}
                </Button>
              </div>

              {llmError && (
                <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-2 text-xs text-destructive">
                  {llmError}
                </div>
              )}

              {llmOutput && steps.length === 0 && (
                <div className="rounded-lg border border-border bg-muted/30 p-3 max-h-60 overflow-y-auto">
                  <AiMarkdown content={llmOutput} />
                </div>
              )}
              {steps.length > 0 && (
                <div className="rounded-lg border border-border bg-muted/30 p-3 max-h-60 overflow-y-auto">
                  <AssistantStepsRenderer
                    steps={steps}
                    finalText={llmOutput}
                    mode="sequential"
                    onConfirm={handleConfirmToolCall}
                  />
                </div>
              )}
            </div>
          )}

          {/* Citations (shown for all tabs if available) */}
          {citations.length > 0 && activeTab !== "analyse" && (
            <div className="mt-3 border-t border-border pt-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Sources
              </p>
              <div className="flex flex-wrap gap-1.5">
                {citations.map((c, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary"
                  >
                    {c.label}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          {!isLocalTab && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopy}
              disabled={!prompt}
              data-testid="ai-copy-prompt"
            >
              <Clipboard className="size-3.5 mr-1" />
              {copied ? "Copié !" : "Copier le prompt"}
            </Button>
          )}
          <div className="flex-1" />
          <Button type="button" variant="ghost" size="sm" onClick={() => props.onOpenChange(false)}>
            Fermer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Explain sub-tab ──────────────────────────────────────────────────
function ExplainTab({
  responseHeaders,
  responseBody,
  authHeader,
}: {
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  authHeader?: [string, string];
}) {
  const { t } = useTranslation();
  // JWT decode (if any)
  const jwtInfo = useMemo(() => {
    if (!authHeader) return null;
    const token = authHeader[1].replace(/^Bearer\s+/i, "").trim();
    return decodeJwt(token);
  }, [authHeader]);

  // JSON annotation
  const jsonAnnotation = useMemo(() => {
    if (!responseBody) return null;
    try {
      const parsed = JSON.parse(responseBody);
      return {
        ok: true,
        tree: annotateJson(parsed),
        summary: summarizeAnnotated(annotateJson(parsed)),
      };
    } catch {
      return null;
    }
  }, [responseBody]);

  return (
    <div className="space-y-3">
      {jwtInfo && (
        <div className="rounded-lg border border-border bg-card p-3 space-y-1">
          <p className="text-xs font-semibold flex items-center gap-1.5">
            <Lightbulb className="size-3 text-warning" />
            {t("ai.modal.jwtDetected")}
            {jwtInfo.expired && (
              <span className="ml-auto text-[10px] font-bold uppercase rounded bg-destructive/20 text-destructive px-1.5 py-0.5">
                {t("ai.modal.expired")}
              </span>
            )}
          </p>
          <pre className="text-[10px] font-mono whitespace-pre-wrap break-all bg-muted/40 p-2 rounded">
            {JSON.stringify(
              { header: jwtInfo.header, payload: jwtInfo.payload, exp: jwtInfo.expiresAt },
              null,
              2,
            )}
          </pre>
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-3 space-y-2">
        <p className="text-xs font-semibold">{t("ai.modal.responseHeaders")}</p>
        {responseHeaders && Object.keys(responseHeaders).length > 0 ? (
          <div className="space-y-1">
            {Object.entries(responseHeaders).map(([k, v]) => {
              const ex = explainHeader(k, v);
              return (
                <div key={k} className="text-[11px] space-y-0.5">
                  <div>
                    <span className="font-mono font-bold">{k}</span>
                    <span className="text-muted-foreground">: </span>
                    <span className="font-mono break-all">{v}</span>
                  </div>
                  <p className="text-muted-foreground italic pl-3">{ex.description}</p>
                  {ex.warnings.length > 0 && (
                    <ul className="pl-3 space-y-0.5">
                      {ex.warnings.map((w, i) => (
                        <li key={i} className="text-warning">
                          ⚠ {w}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic">{t("ai.modal.noHeaders")}</p>
        )}
      </div>

      {jsonAnnotation?.ok && jsonAnnotation.tree && (
        <div className="rounded-lg border border-border bg-card p-3 space-y-1">
          <p className="text-xs font-semibold">{t("ai.modal.jsonStructure")}</p>
          <p className="text-[10px] font-mono text-muted-foreground">{jsonAnnotation.summary}</p>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import { useRequestStore } from "@/hooks/use-request-store";
import i18n from "@/src/i18n";
import { streamLLM } from "@/src/ai/cloud-engine/llm";
import { buildRequestContext } from "@/src/ai/local-engine/context";
import {
  loadAIProvider,
  loadApiKey,
  loadAiBaseUrl,
  loadAiModel,
  loadOllamaConfig,
} from "@/lib/config";
import { isAiConfigured } from "@/lib/ai-config";
import {
  REQLY_TOOLS,
  executeAuthorizedToolCall,
  maskSensitiveObject,
  type ToolResult,
  type ToolCall,
} from "@/lib/llm-tools";
import type { ProcessStep } from "@/src/ai/components/assistant-steps-renderer";
import type { ChatMessage, ChatMessagePhase } from "@/src/ai/components/ai-sidebar-types";
import type { ApprovalSource } from "@/src/ai/agent/permissions";
import { loadRules, buildRulesSystemPrompt } from "@/src/ai/agent/rules";
import { attachmentsToPrompt } from "@/src/ai/agent/context-picker";
import { emptyUsage, addUsage } from "@/src/ai/agent/usage";
import { createDefaultCommands, type SlashCommandContext } from "@/src/ai/agent/commands";
import { extractTextToolCalls, stripToolCallText } from "@/src/ai/agent/text-tools";
import type { AgentMode, ContextAttachment, AgentUsage } from "@/src/ai/agent/types";
import type { ParsedCodeRequest } from "@/src/ai/agent/code-request";

const STALL_TIMEOUT_MS = 45_000;

/** Construit l'état de l'étape d'un appel d'outil, en exposant le résultat
 *  (sortie de requête HTTP) dans `detail` pour que la carte d'exécution puisse
 *  l'analyser (méthode, URL, status, durée). */
function buildStepState(
  tc: { callId: string; name: string; arguments: string },
  result: ToolResult,
): ProcessStep {
  if (tc.name === "execute_request") {
    return {
      type: "execute",
      label: result.error ? i18n.t("ai.hooks.requestErrorLabel") : i18n.t("ai.hooks.requestLabel"),
      status: result.error ? ("error" as const) : ("done" as const),
      detail: result.error ? result.error : result.content,
    };
  }
  return {
    type: "create",
    label: tc.name,
    status: result.error ? "error" : "done",
  };
}

export function useAiSidebarChat() {
  const pathname = usePathname();

  // ── State ─────────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // R19 — configuration IA absente/invalide : la sidebar affiche alors un CTA
  // « Configurer l'accès IA » au lieu de laisser filer une erreur proxy brute.
  const [missingConfig, setMissingConfig] = useState(false);

  // Editing
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");

  // Copy state
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  // Explicit execution requested from a code block. It is kept separate from
  // the model confirmation resolver so a user can review the request first.
  const [pendingCodeRequest, setPendingCodeRequest] = useState<ParsedCodeRequest | null>(null);
  const [isExecutingCode, setIsExecutingCode] = useState(false);

  // ── Agent state ───────────────────────────────────────────────────────────
  const [agentMode, setAgentMode] = useState<AgentMode>("act");
  const [autoApply, setAutoApply] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<{
    planText: string;
    toolCalls: ToolCall[];
    reasoningContent?: string;
  } | null>(null);
  const [attachments, setAttachments] = useState<ContextAttachment[]>([]);
  const [sessionUsage, setSessionUsage] = useState<AgentUsage>(emptyUsage());
  const [modelUsed, setModelUsed] = useState<string | null>(null);
  const [rulesPanelOpen, setRulesPanelOpen] = useState(false);
  const [permissionsPanelOpen, setPermissionsPanelOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const confirmResolverRef = useRef<((confirmed: boolean) => void) | null>(null);
  const pendingPlanRef = useRef<{ toolCalls: ToolCall[]; reasoningContent?: string } | null>(null);
  const agentModeRef = useRef<AgentMode>(agentMode);
  useEffect(() => {
    agentModeRef.current = agentMode;
  }, [agentMode]);
  // Restore mode to previous value after plan execution completes.
  const restoreModeRef = useRef<AgentMode | null>(null);
  // Wired by the sidebar to call history.handleNewSession on /new.
  const newSessionRef = useRef<(() => void) | null>(null);
  const setNewSessionHandler = useCallback((fn: () => void) => {
    newSessionRef.current = fn;
  }, []);

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ── Auto-scroll ───────────────────────────────────────────────────────────
  // Note: `messagesEndRef` pointe sur le conteneur scrollable lui-même (voir
  // AiSidebar). `scrollIntoView` ne scrollerait pas son propre contenu — on
  // positionne donc `scrollTop` sur la hauteur totale du contenu.
  // On ne force le défilement que si l'utilisateur est déjà proche du bas,
  // pour ne pas le tirer vers le bas pendant qu'il remonte lire du contenu.
  const scrollToBottom = useCallback(() => {
    const el = messagesEndRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // ── Focus input when it exists ────────────────────────────────────────────
  // (the parent passes a separate `open` prop; focus is handled there)

  // ── Send message ──────────────────────────────────────────────────────────
  const gatedExecute = useCallback(
    async (
      tc: { callId: string; name: string; arguments: string },
      approval: ApprovalSource = "none",
    ): Promise<ToolResult> => {
      return executeAuthorizedToolCall(
        { id: tc.callId, name: tc.name, arguments: tc.arguments },
        { depth: 0, approval },
      );
    },
    [],
  );

  const requestCodeExecution = useCallback((request: ParsedCodeRequest) => {
    setPendingCodeRequest(request);
  }, []);

  const cancelCodeExecution = useCallback(() => {
    if (!isExecutingCode) setPendingCodeRequest(null);
  }, [isExecutingCode]);

  const confirmCodeExecution = useCallback(async () => {
    const request = pendingCodeRequest;
    if (!request || isExecutingCode) return;

    setPendingCodeRequest(null);
    setIsExecutingCode(true);
    const callId = `code-${Date.now()}`;
    const userMessage: ChatMessage = {
      role: "user",
      content: i18n.t("ai.code.runRequestMessage", { method: request.method, url: request.url }),
    };
    const runningStep: ProcessStep = {
      type: "execute",
      label: i18n.t("ai.code.executing"),
      status: "in_progress",
    };
    setMessages((prev) => [
      ...prev,
      userMessage,
      { role: "assistant", content: "", steps: [runningStep], phase: "tool_calling" },
    ]);

    try {
      const result = await gatedExecute(
        {
          callId,
          name: "execute_request",
          arguments: JSON.stringify(request),
        },
        "code",
      );
      const step: ProcessStep = {
        type: "execute",
        label: result.error ? i18n.t("ai.code.executionFailed") : i18n.t("ai.code.executionDone"),
        status: result.error ? "error" : "done",
        detail: result.error ?? result.content,
      };
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last?.role === "assistant") {
          copy[copy.length - 1] = {
            ...last,
            content: result.error
              ? i18n.t("ai.code.executionError", { error: result.error })
              : result.content,
            steps: [step],
            phase: "done",
          };
        }
        return copy;
      });
    } finally {
      setIsExecutingCode(false);
    }
  }, [gatedExecute, isExecutingCode, pendingCodeRequest]);

  const sendMessage = useCallback(
    async (
      content: string,
      options?: {
        planCalls?: ToolCall[];
        skipUserMessage?: boolean;
        /** Override des attachments à envoyer au modèle (utilisé par l'édition). */
        attachmentsOverride?: ContextAttachment[];
        /** `reasoning_content` du tour de plan (DeepSeek thinking). */
        reasoningContent?: string;
      },
    ) => {
      if (!content.trim() || isLoading) return;
      setError(null);
      setMissingConfig(false);

      // R19 — pré-check config (même validation que parseAiConfig, via
      // isAiConfigured) : sans clé configurée, on guide vers le réglage au
      // lieu de propager l'erreur proxy brute du premier appel LLM.
      if (!isAiConfigured()) {
        setMissingConfig(true);
        return;
      }

      const effectiveAttachments = options?.attachmentsOverride ?? attachments;
      if (!options?.planCalls?.length && !options?.skipUserMessage) {
        const userMsg: ChatMessage = {
          role: "user",
          content: content.trim(),
          attachments: effectiveAttachments.length > 0 ? effectiveAttachments : undefined,
        };
        setMessages([...messages, userMsg]);
      }
      setIsLoading(true);

      // ── Step builder: accumulates process steps and syncs to the UI ──
      const steps: ProcessStep[] = [];

      const syncSteps = () => {
        setMessages((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last && last.role === "assistant") {
            copy[copy.length - 1] = { ...last, steps: [...steps] };
          } else {
            copy.push({
              role: "assistant",
              content: "",
              steps: [...steps],
              phase: last?.role === "user" ? "tool_calling" : "streaming",
            });
          }
          return copy;
        });
      };

      // Met à jour la phase du message assistant courant (tool_calling /
      // awaiting_response / streaming / done) sans toucher au contenu ni aux
      // étapes. La bulle de message utilise cette phase pour afficher un
      // indicateur « typing » au lieu d'une bulle vide entre la fin des tool
      // calls et l'arrivée du premier token de texte.
      const setPhase = (phase: ChatMessagePhase) => {
        setMessages((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last && last.role === "assistant") {
            copy[copy.length - 1] = { ...last, phase };
          }
          return copy;
        });
      };

      const addStep = (type: ProcessStep["type"], label: string) => {
        // Une seule étape « through » : si le raisonnement précédent est encore
        // en cours, on met à jour son libellé (« Through… » → « Analyse en
        // cours… ») au lieu d'empiler un second spinner redondant.
        const prev = steps[steps.length - 1];
        if (
          type === "through" &&
          prev &&
          prev.type === "through" &&
          prev.status === "in_progress"
        ) {
          prev.label = label;
          syncSteps();
          return;
        }
        steps.push({ type, label, status: "in_progress" });
        syncSteps();
      };

      const finishThrough = () => {
        for (const s of steps) {
          if (s.type === "through" && s.status === "in_progress") {
            s.status = "done";
            s.label = i18n.t("ai.hooks.analysisDone");
          }
        }
        syncSteps();
      };

      try {
        // Step 0: through
        addStep("through", "Through...");

        // Load AI config from settings
        const provider = loadAIProvider();
        const apiKey = loadApiKey(provider);
        const aiModel = loadAiModel(provider);
        const aiBaseUrl = loadAiBaseUrl(provider);
        const ollamaConfig = loadOllamaConfig();
        setModelUsed(aiModel || null);

        // Get fresh context for prompt building
        const fresh = useRequestStore.getState();
        const requestCtx = buildRequestContext(
          {
            method: fresh.currentRequest?.method ?? "GET",
            url: fresh.currentRequest?.url ?? "",
            headers: fresh.currentRequest?.headers ?? {},
            body:
              typeof fresh.currentRequest?.body === "string"
                ? fresh.currentRequest.body
                : undefined,
            authType: "none",
          },
          fresh.lastResponse
            ? {
                status: fresh.lastResponse.status,
                statusText: "",
                headers: fresh.lastResponse.headers ?? {},
                body: fresh.lastResponse.body,
                duration: fresh.lastResponse.durationMs ?? 0,
                size: 0,
              }
            : undefined,
        );

        addStep("through", "Analyse en cours…");

        const rulesFile = loadRules(fresh.activeWorkspaceId ?? "ws-personal");
        const rulesPrompt = buildRulesSystemPrompt(rulesFile);
        const attachmentsPrompt = attachmentsToPrompt(effectiveAttachments);

        const systemPrompt = [
          `Tu es ReqlyAI, un assistant API spécialisé et agent intégré à Reqly. Tu aides les développeurs à diagnostiquer des erreurs HTTP, comprendre des réponses, et améliorer leurs requêtes. Tu réponds en français, de façon concise et actionnable. Quand tu suggères un fix, donne le code exact prêt à coller.`,
          `Dans l'esprit de Claude Code, tu peux créer des collections, des requêtes, des environnements, et exécuter des requêtes directement.`,
          `Page: ${pathname}`,
          rulesPrompt || "Règles actives : aucune.",
          agentModeRef.current === "plan"
            ? "MODE PLAN : tu PROPOSES un plan d'actions en APPELANT les outils que tu exécuterais (function calling, arguments réels) — ces appels ne seront PAS exécutés, ils sont capturés pour validation par l'utilisateur. Ajoute un court texte décrivant le plan."
            : "MODE ACT : tu peux exécuter les outils disponibles pour agir.",
          autoApply
            ? "Auto-approuver : tu peux exécuter les outils sans redemander, sauf si une permission l'interdit."
            : "Avant toute action destructive, demande une confirmation explicite.",
          "Réponds en français. Sois concis et actionnable.",
        ].join("\n\n");

        // ── Conversation memory: inject prior messages for context ──
        // Exclude the message being sent to avoid duplication.
        let priorMessages = messages;
        if (options?.skipUserMessage || options?.planCalls?.length) {
          priorMessages = messages.slice(0, -1);
        }
        const transcript = priorMessages
          .slice(-8)
          .map((m) => {
            const role = m.role === "user" ? "Utilisateur" : "Assistant";
            const text = (m.content || "").slice(0, 1500);
            return text ? `${role}: ${text}` : "";
          })
          .filter(Boolean)
          .join("\n\n");

        const contentWithContext = [
          transcript ? `## Conversation précédente\n${transcript}` : null,
          content,
          attachmentsPrompt,
        ]
          .filter(Boolean)
          .join("\n\n");

        // ── Streaming + tool-calling loop ────────────────────
        // NOTE: the assistant message was already created by syncSteps()
        // (first addStep). Do NOT push a second one here, or the sidebar
        // shows duplicate "Through…" bubbles that stay stuck.
        let fullText = "";
        const MAX_TOOL_TURNS = 5;
        let turnCount = 0;
        const previousTurns: Array<{
          assistantToolCalls: Array<{ id: string; name: string; arguments: string }>;
          toolResults: ToolResult[];
          reasoningContent?: string;
        }> = [];
        let retriedWithoutTools = false;

        const runTurn = async () => {
          // Texte du tour courant uniquement : on remplace le texte des tours
          // précédents (narration « je vais créer… ») pour que le message final
          // ne contienne que la réponse du dernier tour, pas un collage des
          // narrations successives + des résultats d'outils déjà affichés.
          fullText = "";
          const controller = new AbortController();
          abortRef.current = controller;
          const opts = {
            provider,
            apiKey,
            model: aiModel || undefined,
            openaiUrl:
              provider === "openai" || provider === "custom" ? aiBaseUrl || undefined : undefined,
            host: ollamaConfig?.host,
            port: ollamaConfig?.port,
            question: contentWithContext,
            ctx: requestCtx,
            system: systemPrompt,
            signal: controller.signal,
            tools: retriedWithoutTools ? undefined : REQLY_TOOLS,
            tool_choice: retriedWithoutTools ? undefined : "auto",
            previousTurns: previousTurns.length > 0 ? [...previousTurns] : undefined,
          };

          const stream = streamLLM(opts);
          const toolCallsThisTurn: Array<{
            callId: string;
            name: string;
            arguments: string;
          }> = [];
          // `reasoning_content` du tour (DeepSeek thinking mode) — renvoyé dans
          // l'historique du tour suivant, obligatoire sinon HTTP 400.
          let reasoningThisTurn = options?.reasoningContent ?? "";

          // Stall timeout: si aucun token ne progresse, on abandonne le stream
          // pour éviter un "Réflexion…" infini quand le provider amont ne répond pas.
          let lastActivity = Date.now();
          let didTimeout = false;
          const stallTimer = setInterval(() => {
            if (Date.now() - lastActivity > STALL_TIMEOUT_MS) {
              didTimeout = true;
              controller.abort();
            }
          }, 5000);

          try {
            for await (const token of stream) {
              lastActivity = Date.now();
              if (token.type === "usage") {
                setSessionUsage((prev) => addUsage(prev, token.usage));
                setMessages((prev) => {
                  const copy = [...prev];
                  const last = copy[copy.length - 1];
                  if (last && last.role === "assistant") {
                    copy[copy.length - 1] = {
                      ...last,
                      usage: addUsage(last.usage ?? emptyUsage(), token.usage),
                    };
                  }
                  return copy;
                });
              } else if (token.type === "text") {
                fullText += token.value;
                setMessages((prev) => {
                  const copy = [...prev];
                  const last = copy[copy.length - 1];
                  if (last && last.role === "assistant") {
                    copy[copy.length - 1] = {
                      ...last,
                      content: fullText,
                      steps: [...steps],
                      phase: "streaming",
                    };
                  }
                  return copy;
                });
              } else if (token.type === "tool_calls") {
                reasoningThisTurn += token.reasoningContent ?? "";
                toolCallsThisTurn.push(
                  ...token.calls.map((c: { id: string; name: string; arguments: string }) => ({
                    callId: c.id,
                    name: c.name,
                    arguments: c.arguments,
                  })),
                );
                setPhase("tool_calling");
              }
            }
          } catch (e: unknown) {
            if (didTimeout) {
              steps.push({
                type: "error",
                label: i18n.t("ai.hooks.noModelResponse"),
                status: "error",
              });
              syncSteps();
              return;
            }
            if (
              opts.tools &&
              !retriedWithoutTools &&
              /tools|functions|function calling|tool_calls|unsupported/i.test(
                e instanceof Error ? e.message : "",
              )
            ) {
              retriedWithoutTools = true;
              setMessages((prev) => {
                const copy = [...prev];
                const last = copy[copy.length - 1];
                if (last && last.role === "assistant") {
                  copy[copy.length - 1] = {
                    ...last,
                    content: "",
                    steps: [...steps],
                  };
                }
                return copy;
              });
              fullText = "";
              await runTurn();
              return;
            }
            throw e;
          } finally {
            clearInterval(stallTimer);
          }

          if (toolCallsThisTurn.length === 0) {
            // Text-fallback: some models write tool calls as plain text
            // (e.g. <create_collection><name>Test</name></create_collection>)
            // instead of emitting real function-calling delta.tool_calls.
            // Detect those and execute them for real.
            const textCalls = extractTextToolCalls(fullText);
            if (textCalls.length > 0) {
              fullText = stripToolCallText(fullText, textCalls);
              setMessages((prev) => {
                const copy = [...prev];
                const last = copy[copy.length - 1];
                if (last && last.role === "assistant") {
                  copy[copy.length - 1] = {
                    ...last,
                    content: fullText,
                    steps: [...steps],
                  };
                }
                return copy;
              });
              if (agentModeRef.current === "plan") {
                const planCalls: ToolCall[] = textCalls.map((c) => ({
                  id: c.id,
                  name: c.name,
                  arguments: c.arguments,
                }));
                pendingPlanRef.current = { toolCalls: planCalls };
                setPendingPlan({ planText: fullText, toolCalls: planCalls });
                steps.push({
                  type: "pause",
                  label: i18n.t("ai.hooks.planModeCount", { count: textCalls.length }),
                  status: "done",
                });
                syncSteps();
                return;
              }
              await executeTools(
                textCalls.map((c) => ({
                  callId: c.id,
                  name: c.name,
                  arguments: c.arguments,
                })),
              );
              return;
            }
            return;
          }

          if (agentModeRef.current === "plan") {
            const planCalls: ToolCall[] = toolCallsThisTurn.map((tc) => ({
              id: tc.callId,
              name: tc.name,
              arguments: tc.arguments,
            }));
            pendingPlanRef.current = { toolCalls: planCalls, reasoningContent: reasoningThisTurn };
            setPendingPlan({
              planText: fullText,
              toolCalls: planCalls,
              reasoningContent: reasoningThisTurn,
            });
            steps.push({
              type: "pause",
              label: i18n.t("ai.hooks.planModeCount", { count: toolCallsThisTurn.length }),
              status: "done",
            });
            syncSteps();
            return;
          }

          await executeTools(toolCallsThisTurn, false, reasoningThisTurn);
        };

        const executeTools = async (
          calls: Array<{ callId: string; name: string; arguments: string }>,
          preApproved = false,
          reasoningContent?: string,
        ) => {
          // Le raisonnement (« Through… ») est terminé dès que les outils
          // commencent : résoudre l'étape pour que le spinner ne tourne pas
          // en parallèle des étapes d'exécution (mode timeline).
          finishThrough();

          // Create pending steps for tool calls
          for (const tc of calls) {
            let safeArgs: Record<string, unknown> = {};
            try {
              safeArgs = JSON.parse(tc.arguments);
            } catch {
              /* ignore */
            }
            const masked = maskSensitiveObject(safeArgs);
            steps.push({
              type: "create",
              label: `${tc.name}(${JSON.stringify(masked)})`,
              status: "in_progress",
            });
            syncSteps();
          }

          // Execute tools sequentially, gated by permissions
          const results: ToolResult[] = [];
          for (let i = 0; i < calls.length; i++) {
            const tc = calls[i];
            try {
              const result = await gatedExecute(
                tc,
                preApproved ? "plan" : autoApply ? "autoApply" : "none",
              );
              const toolUsage = result.usage;
              if (toolUsage) {
                setSessionUsage((prev) => addUsage(prev, toolUsage));
              }
              results.push(result);
              if (result.requireConfirmation) {
                // En attente de confirmation (permission « ask ») : l'outil n'a
                // PAS échoué — il attend l'accord de l'utilisateur. Ne pas le
                // marquer en erreur, sinon tous les outils suivants de la file
                // s'affichent en erreur alors qu'ils attendent simplement leur tour.
                steps[steps.length - calls.length + i] = {
                  type: "create",
                  label: `${tc.name} — confirmation requise`,
                  status: "awaiting_confirmation",
                };
              } else {
                steps[steps.length - calls.length + i] = buildStepState(tc, result);
              }
            } catch (e: unknown) {
              results.push({
                callId: tc.callId,
                name: tc.name,
                content: "",
                error: e instanceof Error ? e.message : "Erreur inconnue",
              });
              steps[steps.length - calls.length + i] = {
                type: "error",
                label: `${tc.name} — Erreur`,
                status: "error",
              };
            }
            syncSteps();
          }

          // Check for requireConfirmation — await user confirmation via UI buttons
          let confirmIdx = results.findIndex((r) => r.requireConfirmation);
          const confirmedIndices = new Set<number>();
          while (confirmIdx !== -1) {
            // Garde-fou anti-boucle (bug #2) : si un même appel d'outil redemande
            // confirmation après avoir déjà été validé (handler ignorant `confirmed`),
            // on arrête plutôt que de re-prompt indéfiniment.
            if (confirmedIndices.has(confirmIdx)) {
              results[confirmIdx] = {
                callId: calls[confirmIdx].callId,
                name: calls[confirmIdx].name,
                content: "",
                error: "Confirmation non honorée par l'outil — exécution abandonnée.",
              };
              steps[steps.length - calls.length + confirmIdx] = {
                type: "error",
                label: `${calls[confirmIdx].name} — confirmation non honorée`,
                status: "error",
              };
              syncSteps();
              break;
            }
            const targetTc = calls[confirmIdx];
            steps[steps.length - calls.length + confirmIdx] = {
              type: "create",
              label: `${targetTc.name} — confirmation requise`,
              status: "awaiting_confirmation",
            };
            syncSteps();
            // isLoading stays true: keeps input disabled so no new message
            // can be sent while a confirmation is pending (race fix).
            const confirmed = await new Promise<boolean>((resolve) => {
              confirmResolverRef.current = resolve;
            });
            confirmResolverRef.current = null;
            if (!confirmed) {
              steps[steps.length - calls.length + confirmIdx] = {
                type: "error",
                label: `${targetTc.name} — annulé`,
                status: "error",
              };
              // Les outils suivants de la file attendaient aussi une confirmation :
              // les marquer annulés aussi, sinon ils restent affichés « en attente »
              // sans boutons alors que le flux est arrêté.
              for (let j = confirmIdx + 1; j < results.length; j++) {
                if (results[j].requireConfirmation) {
                  steps[steps.length - calls.length + j] = {
                    type: "error",
                    label: `${calls[j].name} — annulé`,
                    status: "error",
                  };
                }
              }
              syncSteps();
              return;
            }
            const result = await gatedExecute(targetTc, "user");
            const toolUsage = result.usage;
            if (toolUsage) {
              setSessionUsage((prev) => addUsage(prev, toolUsage));
            }
            results[confirmIdx] = result;
            confirmedIndices.add(confirmIdx);
            steps[steps.length - calls.length + confirmIdx] = buildStepState(targetTc, result);
            syncSteps();
            confirmIdx = results.findIndex((r) => r.requireConfirmation);
          }

          // Store turn for multi-turn context
          previousTurns.push({
            assistantToolCalls: calls.map((tc) => ({
              id: tc.callId,
              name: tc.name,
              arguments: tc.arguments,
            })),
            toolResults: results,
            ...(reasoningContent ? { reasoningContent } : {}),
          });
          turnCount++;

          if (turnCount >= MAX_TOOL_TURNS) {
            setError("L'assistant a atteint la limite de 5 tours d'outils.");
            return;
          }

          // Les tool calls sont terminés : passer en attente de la réponse
          // texte du tour suivant. L'UI affiche alors l'indicateur « typing »
          // à la place de la bulle vide, que le provider stream ou non.
          setPhase("awaiting_response");

          // Continue loop
          await runTurn();
        };

        // ── Execute approved plan or run a new LLM turn ──
        if (options?.planCalls?.length) {
          addStep("execute", "Exécution du plan approuvé…");
          await executeTools(
            options.planCalls.map((c) => ({
              callId: c.id,
              name: c.name,
              arguments: c.arguments,
            })),
            true, // pre-approved
            options.reasoningContent,
          );
          // Resolve the "Exécution du plan approuvé…" wrapper so it doesn't
          // keep spinning after the individual tool steps are done.
          for (const s of steps) {
            if (s.type === "execute" && s.status === "in_progress") {
              s.status = "done";
              s.label = "Plan exécuté";
            }
          }
          syncSteps();
        } else {
          await runTurn();
        }

        // ── Resolve the "Through…" spinner so it doesn't loop forever ──
        finishThrough();

        // ── Set final content ────────────────────────────────
        setMessages((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last && last.role === "assistant") {
            copy[copy.length - 1] = {
              ...last,
              content: fullText,
              steps: [...steps],
              phase: "done",
            };
          } else {
            copy.push({
              role: "assistant",
              content: fullText,
              steps: [...steps],
              phase: "done",
            });
          }
          return copy;
        });
      } catch (err) {
        if ((err as { name?: string } | null)?.name === "AbortError") {
          finishThrough();
          setMessages((prev) => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            if (last && last.role === "assistant" && !last.content) {
              copy[copy.length - 1] = {
                ...last,
                content: "⏹ Génération arrêtée.",
                steps: [...steps],
                phase: "done",
              };
            }
            return copy;
          });
        } else {
          const msg = err instanceof Error ? err.message : "Erreur de communication avec l'IA";
          setError(msg);
          // Resolve any in-flight steps so the spinners don't stay stuck forever.
          for (const s of steps) {
            if (s.status === "in_progress") {
              s.status = "error";
              s.label = "Erreur";
            }
          }
          steps.push({ type: "error", label: msg, status: "error" });
          // Show error in the steps timeline and the error banner —
          // leave the bubble content empty so the error is not duplicated.
          setMessages((prev) => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            if (last && last.role === "assistant") {
              copy[copy.length - 1] = {
                ...last,
                content: "",
                steps: [...steps],
                phase: "done",
              };
            } else {
              copy.push({ role: "assistant", content: "", steps: [...steps], phase: "done" });
            }
            return copy;
          });
        }
      } finally {
        // Restore agent mode if it was temporarily changed for plan execution.
        if (restoreModeRef.current) {
          const prevMode = restoreModeRef.current;
          restoreModeRef.current = null;
          setAgentMode(prevMode);
          agentModeRef.current = prevMode;
        }
        confirmResolverRef.current = null;
        abortRef.current = null;
        // Filet de sécurité : ne jamais laisser le spinner « Through… » bloqué,
        // quel que soit le chemin de sortie (happy path, abort, erreur, plan).
        finishThrough();
        setIsLoading(false);
        setEditingIndex(null);
        setEditingText("");
      }
    },
    [messages, isLoading, pathname, autoApply, attachments, gatedExecute],
  );

  // ── Handlers ──────────────────────────────────────────────────────────────

  const stopStreaming = useCallback(() => {
    confirmResolverRef.current?.(false);
    confirmResolverRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    setIsLoading(false);
  }, []);

  const confirmAction = useCallback((confirmed: boolean) => {
    confirmResolverRef.current?.(confirmed);
    confirmResolverRef.current = null;
  }, []);

  const attachContext = useCallback((a: ContextAttachment) => {
    setAttachments((prev) => (prev.some((x) => x.id === a.id) ? prev : [...prev, a]));
  }, []);

  const rejectPlan = useCallback(() => {
    setPendingPlan(null);
  }, []);

  const approvePlan = useCallback(() => {
    const plan = pendingPlanRef.current;
    pendingPlanRef.current = null;
    setPendingPlan(null);
    // Temporarily switch to "act" so tools execute; restore mode in sendMessage's finally.
    restoreModeRef.current = agentModeRef.current;
    setAgentMode("act");
    agentModeRef.current = "act";
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    if (plan?.toolCalls.length) {
      void sendMessage(lastUser.content, {
        planCalls: plan.toolCalls,
        reasoningContent: plan.reasoningContent,
      });
    } else {
      void sendMessage(lastUser.content);
    }
  }, [messages, sendMessage]);

  // Expose setInput for the parent to clear on new session
  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    setMissingConfig(false);
    setEditingIndex(null);
    setEditingText("");
    setSessionUsage(emptyUsage());
    setPendingPlan(null);
    pendingPlanRef.current = null;
  }, []);

  const runSlashCommand = useCallback(
    (name: string, args: string) => {
      const cmdCtx: SlashCommandContext = {
        clearMessages,
        newSession: () => {
          clearMessages();
          newSessionRef.current?.();
        },
        setMode: setAgentMode,
        openRules: () => setRulesPanelOpen(true),
        openPermissions: () => setPermissionsPanelOpen(true),
        compact: () => {
          const lastUser = [...messages].reverse().find((m) => m.role === "user");
          if (lastUser)
            void sendMessage(`Résume la conversation puis réponds à : ${lastUser.content}`);
        },
        exportSession: () => {
          const blob = new Blob([JSON.stringify(messages, null, 2)], {
            type: "application/json",
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = "reqly-session.json";
          a.click();
          URL.revokeObjectURL(url);
        },
        reply: (text) => {
          setMessages((prev) => [...prev, { role: "assistant", content: text }]);
        },
      };
      const cmd = createDefaultCommands().find((c) => c.name === name);
      if (cmd) void cmd.run(args, cmdCtx);
    },
    [clearMessages, messages, sendMessage],
  );

  const handleEditStart = useCallback((index: number, content: string) => {
    setEditingIndex(index);
    setEditingText(content);
  }, []);

  const handleEditCancel = useCallback(() => {
    setEditingIndex(null);
    setEditingText("");
  }, []);

  const handleEditConfirm = useCallback(() => {
    if (editingIndex === null || !editingText.trim()) return;
    const truncated = messages.slice(0, editingIndex);
    const original = messages[editingIndex];
    const preservedAttachments =
      original?.role === "user" && original.attachments?.length ? original.attachments : undefined;
    const userMsg: ChatMessage = {
      role: "user",
      content: editingText.trim(),
      // Conserver les attachments du message édité (sinon ils seraient perdus).
      ...(preservedAttachments ? { attachments: preservedAttachments } : {}),
    };
    // Appliquer la troncature ici, puis envoyer SANS ré-ajouter le message
    // utilisateur (sendMessage le ferait avec un `messages` obsolète et
    // annulerait la troncature). On repasse les attachments préservés pour
    // que le prompt du modèle soit cohérent avec les chips affichées.
    setMessages([...truncated, userMsg]);
    void sendMessage(editingText.trim(), {
      skipUserMessage: true,
      attachmentsOverride: preservedAttachments,
    });
  }, [editingIndex, editingText, messages, sendMessage]);

  const handleRetry = useCallback(() => {
    const lastUserIdx = [...messages].reverse().findIndex((m) => m.role === "user");
    if (lastUserIdx === -1) return;
    const idx = messages.length - 1 - lastUserIdx;
    const lastUser = messages[idx];
    // Truncate everything after the last user message (failed assistant bubble).
    setMessages(messages.slice(0, idx + 1));
    void sendMessage(lastUser.content, {
      skipUserMessage: true,
      attachmentsOverride: lastUser.attachments,
    });
  }, [messages, sendMessage]);

  const handleCopy = useCallback(async (content: string, index: number) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch {
      /* ignore */
    }
  }, []);

  const handleNewMessages = useCallback((newMessages: ChatMessage[]) => {
    setMessages(newMessages);
    setError(null);
    setEditingIndex(null);
    setEditingText("");
  }, []);

  return {
    // State
    messages,
    isLoading,
    error,
    missingConfig,
    editingIndex,
    editingText,
    copiedIndex,
    pendingCodeRequest,
    isExecutingCode,
    // Agent state
    agentMode,
    setAgentMode,
    autoApply,
    setAutoApply,
    pendingPlan,
    approvePlan,
    rejectPlan,
    setPendingPlan,
    attachments,
    setAttachments,
    attachContext,
    sessionUsage,
    modelUsed,
    abortRef,
    stopStreaming,
    confirmAction,
    gatedExecute,
    runSlashCommand,
    rulesPanelOpen,
    setRulesPanelOpen,
    permissionsPanelOpen,
    setPermissionsPanelOpen,
    // Refs
    messagesEndRef,
    inputRef,
    setNewSessionHandler,
    scrollToBottom,
    // Actions
    setError,
    setIsLoading,
    setEditingText,
    // Handlers
    handleEditStart,
    handleEditCancel,
    handleEditConfirm,
    handleRetry,
    handleCopy,
    handleNewMessages,
    requestCodeExecution,
    cancelCodeExecution,
    confirmCodeExecution,
    clearMessages,
    sendMessage,
  };
}

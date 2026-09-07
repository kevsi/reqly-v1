"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import { useRequestStore } from "@/hooks/use-request-store";
import i18n from "@/src/i18n";
import { streamLLM } from "@/src/ai/cloud-engine/llm";
import { buildRequestContext } from "@/src/ai/local-engine/context";
import { isAiConfigured, resolveAiConfig } from "@/lib/ai-config";
import {
  classifyThrownError,
  ProviderErrorCode,
} from "@/src/ai/cloud-engine/provider-errors";
import {
  REQLY_TOOLS,
  executeAuthorizedToolCall,
  getToolTitle,
  maskSensitiveObject,
  type ToolResult,
  type ToolCall,
} from "@/lib/llm-tools";
import type { ProcessStep } from "@/src/ai/components/assistant-steps-renderer";
import type {
  ChatMessage,
  ChatMessagePhase,
  FileAttachment,
} from "@/src/ai/components/ai-sidebar-types";
import type { ApprovalSource } from "@/src/ai/agent/permissions";
import { loadRules, buildRulesSystemPrompt } from "@/src/ai/agent/rules";
import { attachmentsToPrompt } from "@/src/ai/agent/context-picker";
import { extractArtifacts } from "@/src/ai/agent/artifacts";
import { emptyUsage, addUsage } from "@/src/ai/agent/usage";
import { createDefaultCommands, type SlashCommandContext } from "@/src/ai/agent/commands";
import { extractTextToolCalls, stripToolCallText } from "@/src/ai/agent/text-tools";
import type { AgentMode, ContextAttachment, AgentUsage } from "@/src/ai/agent/types";
import { persistence } from "@/lib/persistence";
import { useAiFileAttachments } from "@/src/ai/hooks/use-ai-file-attachments";
import { useAiCodeExecution } from "@/src/ai/hooks/use-ai-code-execution";
import { MAX_FILE_BYTES } from "@/src/ai/agent/file-limits";

/** Décision de confirmation utilisateur : simple ou « toute la série ». */
interface ConfirmDecision {
  confirmed: boolean;
  all: boolean;
}
/** Clé de persistance de l'option « Confirmer en lot » (≠ auto-approval). */
const BATCH_CONFIRM_KEY = "probe_ai_batch_confirm";

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
    // L'erreur brute dans le libellé : sans elle, la timeline affiche
    // « — Erreur » sans dire pourquoi (frustration debug).
    label: result.error
      ? `${getToolTitle(tc.name)} — ${result.error.slice(0, 140)}`
      : getToolTitle(tc.name),
    status: result.error ? ("error" as const) : ("done" as const),
  };
}

export function useAiSidebarChat() {
  const pathname = usePathname();

  // ── State ─────────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Code d'erreur classifié (rate_limit, context_too_long…) → actions banner. */
  const [errorCode, setErrorCode] = useState<ProviderErrorCode | null>(null);
  // R19 — configuration IA absente/invalide : la sidebar affiche alors un CTA
  // « Configurer l'accès IA » au lieu de laisser filer une erreur proxy brute.
  const [missingConfig, setMissingConfig] = useState(false);

  // Editing
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");

  // Copy state
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  // Agent mode & plan state
  const AUTO_APPLY_KEY = "probe_ai_auto_apply";
  const [agentMode, setAgentMode] = useState<AgentMode>("act");
  const [autoApply, setAutoApply] = useState<boolean>(() => {
    try {
      return persistence.getItem<boolean>(AUTO_APPLY_KEY) ?? false;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      void persistence.setItem(AUTO_APPLY_KEY, autoApply);
    } catch {
      /* ignore */
    }
  }, [autoApply]);
  const [pendingPlan, setPendingPlan] = useState<{
    planText: string;
    toolCalls: ToolCall[];
    reasoningContent?: string;
  } | null>(null);
  const [attachments, setAttachments] = useState<ContextAttachment[]>([]);

  // Sub-hooks modulaires (fichiers joints et exécution de code)
  const { files, setFiles, attachFiles, removeFile } = useAiFileAttachments();
  const [sessionUsage, setSessionUsage] = useState<AgentUsage>(emptyUsage());
  const [modelUsed, setModelUsed] = useState<string | null>(null);
  const [rulesPanelOpen, setRulesPanelOpen] = useState(false);
  const [permissionsPanelOpen, setPermissionsPanelOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const confirmResolverRef = useRef<((decision: ConfirmDecision) => void) | null>(null);
  // Exécution d'une action confirmée en cours (loader sur le bouton).
  const [confirmBusy, setConfirmBusy] = useState(false);
  // Option « Confirmer en lot » : un seul Confirmer approuve la série entière
  // en attente — SANS activer l'auto-approbation permanente.
  const [batchConfirm, setBatchConfirmState] = useState<boolean>(() => {
    try {
      return persistence.getItem<boolean>(BATCH_CONFIRM_KEY) ?? false;
    } catch {
      return false;
    }
  });
  const batchConfirmRef = useRef(batchConfirm);
  useEffect(() => {
    batchConfirmRef.current = batchConfirm;
  }, [batchConfirm]);
  const setBatchConfirm = useCallback((v: boolean) => {
    setBatchConfirmState(v);
    void persistence.setItem(BATCH_CONFIRM_KEY, v).catch(() => {});
  }, []);
  const pendingPlanRef = useRef<{ toolCalls: ToolCall[]; reasoningContent?: string } | null>(null);
  const agentModeRef = useRef<AgentMode>(agentMode);
  useEffect(() => {
    agentModeRef.current = agentMode;
  }, [agentMode]);
  // Génération courante : incrémenté par stopStreaming pour invalider toute
  // boucle sendMessage en vol (y compris entre deux tours LLM, pendant une
  // exécution d'outil ou une attente de confirmation).
  const generationIdRef = useRef(0);
  // Miroir des messages pour les handlers (édition, retry, plan) : lit toujours
  // l'état courant, jamais une closure périmée de useCallback.
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
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
  // Deux comportements distincts :
  //  - scrollToBottom (gardé) : pendant le streaming, on ne suit que si
  //    l'utilisateur est déjà proche du bas (il peut remonter lire) ;
  //  - forceScrollToBottom : À L'ENVOI, toujours — l'utilisateur doit voir
  //    son propre message et la réponse qui arrive, même s'il lisait plus haut.
  const scrollToBottom = useCallback(() => {
    const el = messagesEndRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, []);

  const forceScrollToBottom = useCallback(() => {
    // Double passe : après commit React (rAF) + après layout markdown (80 ms).
    requestAnimationFrame(() => {
      const el = messagesEndRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
    window.setTimeout(() => {
      const el = messagesEndRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }, 80);
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

  const {
    pendingCodeRequest,
    isExecutingCode,
    requestCodeExecution,
    cancelCodeExecution,
    confirmCodeExecution,
  } = useAiCodeExecution({ gatedExecute, setMessages });

  const sendMessage = useCallback(
    async (
      content: string,
      options?: {
        planCalls?: ToolCall[];
        skipUserMessage?: boolean;
        /** Override des attachments à envoyer au modèle (utilisé par l'édition). */
        attachmentsOverride?: ContextAttachment[];
        /** Fichiers joints au message (injectés dans le prompt). */
        filesOverride?: FileAttachment[];
        /** Historique explicite (édition/retry) — évite les closures périmées. */
        historyOverride?: ChatMessage[];
        /** `reasoning_content` du tour de plan (DeepSeek thinking). */
        reasoningContent?: string;
      },
    ) => {
      if (!content.trim() || isLoading) return;
      setError(null);
        setErrorCode(null);
      setMissingConfig(false);

      // R19 — pré-check config (même validation que parseAiConfig, via
      // isAiConfigured) : sans clé configurée, on guide vers le réglage au
      // lieu de propager l'erreur proxy brute du premier appel LLM.
      if (!isAiConfigured()) {
        setMissingConfig(true);
        return;
      }

      // H1 — génération identifiée : stopStreaming incrémente generationIdRef,
      // tout await suivi d'un check isStale() abandonne proprement la boucle.
      const myGeneration = generationIdRef.current;
      const isStale = () => generationIdRef.current !== myGeneration;

      const effectiveAttachments = options?.attachmentsOverride ?? attachments;
      const effectiveFiles = options?.filesOverride ?? files;
      if (!options?.planCalls?.length && !options?.skipUserMessage) {
        const userMsg: ChatMessage = {
          id: `msg-${Date.now()}-u`,
          role: "user",
          content: content.trim(),
          attachments: effectiveAttachments.length > 0 ? effectiveAttachments : undefined,
          files: effectiveFiles.length > 0 ? effectiveFiles : undefined,
        };
        setMessages((prev) => [...prev, userMsg]);
      }
      setFiles([]);
      setIsLoading(true);

      // Flux conversationnel (logique salutation vs action) : le message
      // assistant est créé VIDE en phase « awaiting_response » — l'indicateur
      // typing suffit pour une réponse simple. Les étapes (réflexion, outils,
      // confirmations) n'apparaissent que si des outils sont réellement
      // appelés : aucune timeline pour un « bonjour ».
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === "assistant") return prev;
        return [
          ...prev,
          { id: `msg-${Date.now()}-a`, role: "assistant", content: "", steps: [], phase: "awaiting_response" },
        ];
      });

      // Scroll forcé : le message envoyé et la réponse doivent être visibles,
      // même si l'utilisateur lisait plus haut dans la conversation.
      forceScrollToBottom();

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

      // M2 — config résolue par la source unique partagée (même sémantique
      // que le runner : base URL pour openai/custom/grok, fallback modèles).
      // Hors du try : le catch externe classifie l'erreur avec ce provider.
      const cfg = resolveAiConfig();

      try {
        setModelUsed(cfg.model ?? null);

        // Get fresh context for prompt building
        const fresh = useRequestStore.getState();
        const hasActiveRequest = Boolean(fresh.currentRequest?.url);
        const hasLastResponse = Boolean(fresh.lastResponse);
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

        const noRequestNote = !hasActiveRequest && !hasLastResponse
          ? "\n⚠ Aucune requête n'est chargée dans l'éditeur. Tu ne peux PAS inventer de résultat de requête. Si l'utilisateur te demande d'exécuter une requête, utilise l'outil `execute_request` avec une URL réelle ou `execute_requests` sur une collection existante. Ne jamais prétendre qu'une requête a été exécutée sans l'avoir fait via un outil."
          : "";

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
          "IMPORTANT — anti-hallucination : ne jamais prétendre qu'une action a été effectuée sans l'avoir réellement exécutée via un outil. Si tu ne sais pas, appelle l'outil approprié (get_request_context, execute_request, etc.). Ne jamais inventer de status code, durée, ou contenu de réponse.",
          "IMPORTANT — continuité : la conversation est EN COURS. Les tours d'outils déjà exécutés figurent dans l'historique des messages (assistant tool_calls + résultats). Consulte-les AVANT d'agir : ne salue plus, ne te présente plus, ne propose pas une action déjà réalisée (ex. recréer une collection qui existe déjà) et référence par son nom ce qui a déjà été créé. Si une étape a échoué, corrige la cause au lieu de rejouer à l'identique.",
          noRequestNote,
          "Réponds en français. Sois concis et actionnable.",
        ].filter(Boolean).join("\n\n");

        // ── Conversation memory: inject prior messages for context ──
        // M9 — historique explicite si fourni (édition/retry), sinon miroir ref.
        let priorMessages = options?.historyOverride ?? messagesRef.current;
        if (options?.skipUserMessage || options?.planCalls?.length) {
          priorMessages = priorMessages.slice(0, -1);
        }

        // ── Mémoire d'actions inter-messages ──
        // Chaque message assistant conserve les tours d'outils réellement
        // exécutés (create_collection, create_request…). On les reconstruit
        // ici et on les envoie au provider comme VRAI historique de messages
        // (assistant tool_calls + résultats tool) placé AVANT le message
        // courant — le modèle sait ainsi ce qui a déjà été fait, sans quoi
        // il re-crée des collections et redemande la même action.
        const historyTurns = priorMessages
          .flatMap((m) => m.turns ?? [])
          .slice(-40); // cap : ~40 tours couvrent largement une session utile

        // Filtrer les messages assistant qui contiennent des résumés d'outils
        // non vérifiés (risque d'hallucination ré-injectée). La vérité terrain
        // transite désormais par historyTurns — le texte sert de fil narratif.
        const transcript = priorMessages
          .slice(-16)
          .filter((m) => {
            if (m.role !== "assistant") return true;
            const text = m.content || "";
            // Si le message contient "×N" ou "N exécutions terminées" ou "✓" /
            // "✗" mais qu'aucun tool_result n'est visible dans steps, c'est
            // probablement un résumé halluciné → on l'exclut du transcript.
            if (/\d+ exécutions? terminées?/i.test(text)) return false;
            if (/✓.*→ \d+/i.test(text) && text.includes(" requête")) return false;
            if (/✓.*→ \d+/i.test(text) && text.includes("créé")) return false;
            return true;
          })
          .map((m) => {
            const role = m.role === "user" ? "Utilisateur" : "Assistant";
            const text = (m.content || "").slice(0, 3000);
            return text ? `${role}: ${text}` : "";
          })
          .filter(Boolean)
          .join("\n\n");

        // Fichiers joints : blocs de code injectés après les attachments.
        const filesPrompt = effectiveFiles
          .map((f) => {
            if (f.text) {
              return `[Fichier joint: ${f.name} (${f.mime})]\n\`\`\`\n${f.text}\n\`\`\``;
            }
            const reason =
              f.unreadableReason === "too_large"
                ? `trop volumineux (${Math.round(f.size / 1024)} Ko, max ${Math.round(MAX_FILE_BYTES / 1024)} Ko)`
                : "format binaire non lisible en texte";
            return `[Fichier joint: ${f.name} — ${reason}]`;
          })
          .join("\n\n");

        // Instruction système dédiée quand des fichiers lisibles accompagnent
        // la demande : sans cela le modèle peut ignorer les blocs ci-dessous.
        const filesSystemNote = effectiveFiles.some((f) => f.text)
          ? "Des fichiers sont joints à la demande : leur contenu complet est fourni dans des blocs « [Fichier joint: …] ». Appuie-toi sur ce contenu pour répondre (analyse, corrections, extraits cités)."
          : null;
        const systemPromptFinal = [systemPrompt, filesSystemNote].filter(Boolean).join("\n\n");

        const contentWithContext = [
          transcript ? `## Conversation précédente\n${transcript}` : null,
          content,
          attachmentsPrompt,
          filesPrompt || null,
        ]
          .filter(Boolean)
          .join("\n\n");

        // ── Streaming + tool-calling loop ────────────────────
        // NOTE: the assistant message was already created by syncSteps()
        // (first addStep). Do NOT push a second one here, or the sidebar
        // shows duplicate "Through…" bubbles that stay stuck.
        let fullText = "";
        const MAX_TOOL_TURNS = 100;
        let turnCount = 0;
        const previousTurns: Array<{
          assistantToolCalls: Array<{ id: string; name: string; arguments: string }>;
          toolResults: ToolResult[];
          reasoningContent?: string;
        }> = [];
        let retriedWithoutTools = false;

        const runTurn = async () => {
          // H1 — génération invalidée par Stop : ne pas relancer de tour.
          if (isStale()) return;
          // Texte du tour courant uniquement : on remplace le texte des tours
          // précédents (narration « je vais créer… ») pour que le message final
          // ne contienne que la réponse du dernier tour, pas un collage des
          // narrations successives + des résultats d'outils déjà affichés.
          fullText = "";
          const controller = new AbortController();
          abortRef.current = controller;
          const opts = {
            provider: cfg.provider,
            apiKey: cfg.apiKey,
            model: cfg.model,
            openaiUrl: cfg.openaiUrl,
            host: cfg.host,
            port: cfg.port,
            question: contentWithContext,
            ctx: requestCtx,
            system: systemPromptFinal,
            signal: controller.signal,
            tools: retriedWithoutTools ? undefined : REQLY_TOOLS,
            tool_choice: retriedWithoutTools ? undefined : "auto",
            previousTurns: previousTurns.length > 0 ? [...previousTurns] : undefined,
            historyTurns: historyTurns.length > 0 ? [...historyTurns] : undefined,
          };

          let stream = streamLLM(opts);
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

          const consumeStream = async (current: ReturnType<typeof streamLLM>) => {
            for await (const token of current) {
              lastActivity = Date.now();
              if (isStale()) return;
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
          };

          try {
            // P2.7 — retry automatique sur 429/5xx/timeout réseau : max 2
            // relances, UNIQUEMENT si rien n'a encore été reçu (pas de texte
            // partiel ni de tool calls), avec backoff / Retry-After.
            for (let attempt = 0; ; attempt++) {
              try {
                await consumeStream(stream);
                break;
              } catch (e) {
                const cls = classifyThrownError(e, opts.provider);
                const canRetry =
                  cls.retryable &&
                  attempt < 2 &&
                  !didTimeout &&
                  fullText === "" &&
                  toolCallsThisTurn.length === 0 &&
                  !isStale();
                if (!canRetry) throw e;
                const wait = Math.min(cls.retryAfterMs ?? 1200 * (attempt + 1), 6000);
                steps.push({
                  type: "through",
                  label: i18n.t("ai.hooks.retrying", { seconds: Math.round(wait / 1000) }),
                  status: "done",
                });
                syncSteps();
                await new Promise((r) => setTimeout(r, wait));
                stream = streamLLM(opts);
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

          // H1 — Stop pendant le stream : ne pas enchaîner tools/texte.
          if (isStale()) return;

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
          // Flux logique : la réflexion n'est affichée QUE si des outils sont
          // appelés. Première exécution d'outils → insérer l'étape « Réflexion »
          // (déjà terminée : elle a eu lieu pendant la génération), puis les
          // étapes d'outils suivent dans l'ordre réflexion → outils → réponse.
          if (!steps.some((s) => s.type === "through")) {
            steps.push({
              type: "through",
              label: i18n.t("ai.hooks.analysisDone"),
              status: "done",
            });
          }
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
            // H1 — Stop pendant la file d'outils : abandon immédiat.
            if (isStale()) return;
            try {
              const result = await gatedExecute(
                tc,
                preApproved ? "plan" : autoApply ? "autoApply" : "none",
              );
              // H1 — Stop pendant l'exécution de l'outil lui-même.
              if (isStale()) return;
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
                  label: `${getToolTitle(tc.name)} — confirmation requise`,
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
                label: `${getToolTitle(tc.name)} — Erreur`,
                status: "error",
              };
            }
            syncSteps();
          }

          // Check for requireConfirmation — await user confirmation via UI buttons
          let confirmIdx = results.findIndex((r) => r.requireConfirmation);
          const confirmedIndices = new Set<number>();
          // Mode lot : un Confirmer approuve aussi les suivants de la série
          // (bouton dédié OU option « Confirmer en lot » activée).
          let batchApprove = false;
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
                label: `${getToolTitle(calls[confirmIdx].name)} — confirmation non honorée`,
                status: "error",
              };
              syncSteps();
              break;
            }
            const targetTc = calls[confirmIdx];
            if (!batchApprove) {
              steps[steps.length - calls.length + confirmIdx] = {
                type: "create",
                label: `${getToolTitle(targetTc.name)} — confirmation requise`,
                status: "awaiting_confirmation",
              };
              syncSteps();
              // isLoading stays true: keeps input disabled so no new message
              // can be sent while a confirmation is pending (race fix).
              const decision = await new Promise<ConfirmDecision>((resolve) => {
                confirmResolverRef.current = resolve;
              });
              confirmResolverRef.current = null;
              // H1 — Stop pendant l'attente : abandon (stopStreaming a résolu
              // {confirmed:false} et invalidé la génération).
              if (!decision.confirmed || isStale()) {
                steps[steps.length - calls.length + confirmIdx] = {
                  type: "error",
                  label: `${getToolTitle(targetTc.name)} — annulé`,
                  status: "error",
                };
                // Les outils suivants de la file attendaient aussi une confirmation :
                // les marquer annulés aussi, sinon ils restent affichés « en attente »
                // sans boutons alors que le flux est arrêté.
                for (let j = confirmIdx + 1; j < results.length; j++) {
                  if (results[j].requireConfirmation) {
                    steps[steps.length - calls.length + j] = {
                      type: "error",
                      label: `${getToolTitle(calls[j].name)} — annulé`,
                      status: "error",
                    };
                  }
                }
                syncSteps();
                return;
              }
              if (decision.all || batchConfirmRef.current) batchApprove = true;
            } else {
              // Approuvé en lot : montrer que l'action s'exécute (pas de boutons).
              steps[steps.length - calls.length + confirmIdx] = {
                type: "create",
                label: `${getToolTitle(targetTc.name)}`,
                status: "in_progress",
              };
              syncSteps();
            }
            setConfirmBusy(true);
            let result: ToolResult;
            try {
              result = await gatedExecute(targetTc, "user");
            } finally {
              setConfirmBusy(false);
            }
            if (isStale()) return;
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
            setError(`L'assistant a atteint la limite de ${MAX_TOOL_TURNS} tours d'outils.`);
            return;
          }

          // Les tool calls sont terminés : passer en attente de la réponse
          // texte du tour suivant. L'UI affiche alors l'indicateur « typing »
          // à la place de la bulle vide, que le provider stream ou non.
          setPhase("awaiting_response");

          // H1 — Stop pendant les outils : ne pas relancer de tour LLM.
          if (isStale()) return;

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

        // H1 — génération annulée : ne pas écraser l'état UI final.
        if (isStale()) return;

        // ── Artefacts : blocs de code notables promus en cartes + panneau ──
        const extracted = extractArtifacts(fullText);
        const finalText = extracted.artifacts.length > 0 ? extracted.text : fullText;

        // ── Set final content ────────────────────────────────
        setMessages((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last && last.role === "assistant") {
            copy[copy.length - 1] = {
              ...last,
              content: finalText,
              steps: [...steps],
              artifacts: extracted.artifacts.length > 0 ? extracted.artifacts : undefined,
              // Mémoire d'actions : les tool calls + résultats de CE send sont
              // conservés sur le message pour alimenter l'historique multi-tours
              // du PROCHAIN envoi (mémoire inter-messages, pas seulement intra).
              turns: previousTurns.length > 0 ? [...previousTurns] : undefined,
              phase: "done",
            };
          } else {
            copy.push({
              role: "assistant",
              content: finalText,
              steps: [...steps],
              artifacts: extracted.artifacts.length > 0 ? extracted.artifacts : undefined,
              turns: previousTurns.length > 0 ? [...previousTurns] : undefined,
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
          // P2.5 — erreur classifiée : message FR actionnable + code exposé à
          // la banner (actions contextuelles Settings / Compact / Session).
          const cls = classifyThrownError(err, cfg.provider);
          setError(cls.userMessage);
          setErrorCode(cls.code);
          // Resolve any in-flight steps so the spinners don't stay stuck forever.
          for (const s of steps) {
            if (s.status === "in_progress") {
              s.status = "error";
              s.label = i18n.t("common.error");
            }
          }
          steps.push({ type: "error", label: cls.userMessage, status: "error" });
          // P1.3 — le texte déjà streamé est PRÉSERVÉ (aligné sur le chemin
          // stall-timeout) : on n'efface plus la réponse partielle.
          setMessages((prev) => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            const partial =
              last && last.role === "assistant" && last.content
                ? `${last.content}\n\n*(${i18n.t("ai.hooks.interrupted")})*`
                : "";
            if (last && last.role === "assistant") {
              copy[copy.length - 1] = {
                ...last,
                content: partial,
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
    [isLoading, pathname, autoApply, attachments, files, gatedExecute, forceScrollToBottom, setFiles],
  );

  // ── Handlers ──────────────────────────────────────────────────────────────

  const stopStreaming = useCallback(() => {
    // Invalide toute la génération en cours : les boucles sendMessage/runTurn/
    // executeTools vérifient generationIdRef après chaque await et abandonnent.
    generationIdRef.current += 1;
    confirmResolverRef.current?.({ confirmed: false, all: false });
    confirmResolverRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    setIsLoading(false);
  }, []);

  /** Répond à une demande de confirmation. `all` = approuver aussi toute la
   *  série en attente (bouton « Tout confirmer »). */
  const confirmAction = useCallback((confirmed: boolean, all = false) => {
    confirmResolverRef.current?.({ confirmed, all });
    confirmResolverRef.current = null;
  }, []);

  const attachContext = useCallback((a: ContextAttachment) => {
    setAttachments((prev) => (prev.some((x) => x.id === a.id) ? prev : [...prev, a]));
  }, []);

  // (note: attachFiles et removeFile sont gérés par le sub-hook useAiFileAttachments)

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
    const lastUser = [...messagesRef.current].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    if (plan?.toolCalls.length) {
      void sendMessage(lastUser.content, {
        planCalls: plan.toolCalls,
        reasoningContent: plan.reasoningContent,
      });
    } else {
      void sendMessage(lastUser.content);
    }
  }, [sendMessage]);

  // Expose setInput for the parent to clear on new session
  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    setErrorCode(null);
    setMissingConfig(false);
    setEditingIndex(null);
    setEditingText("");
    setSessionUsage(emptyUsage());
    setPendingPlan(null);
    setFiles([]);
    pendingPlanRef.current = null;
  }, [setFiles]);

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
          // P2.6 — /compact RÉEL : tronque l'historique aux 6 derniers messages
          // (le transcript envoyé au modèle repart de cette base réduite), puis
          // demande un résumé. Sans troncature, la commande ne pouvait pas
          // sauver une session qui dépassait la fenêtre de contexte.
          const current = messagesRef.current;
          const kept = current.slice(-6);
          if (kept.length < current.length) {
            setMessages(kept);
            messagesRef.current = kept;
          }
          const lastUser = [...kept].reverse().find((m) => m.role === "user");
          void sendMessage(
            lastUser
              ? `Historique condensé. Résume l'état de la conversation en 3 points puis réponds à : ${lastUser.content}`
              : "Historique condensé. Résume l'état de la conversation en 3 points.",
            { historyOverride: kept },
          );
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
    // M9 — lit l'état courant via le ref, jamais la closure périmée.
    const current = messagesRef.current;
    const truncated = current.slice(0, editingIndex);
    const original = current[editingIndex];
    const preservedAttachments =
      original?.role === "user" && original.attachments?.length ? original.attachments : undefined;
    const preservedFiles =
      original?.role === "user" && original.files?.length ? original.files : undefined;
    const userMsg: ChatMessage = {
      role: "user",
      content: editingText.trim(),
      // Conserver les attachments du message édité (sinon ils seraient perdus).
      ...(preservedAttachments ? { attachments: preservedAttachments } : {}),
      ...(preservedFiles ? { files: preservedFiles } : {}),
    };
    // Appliquer la troncature ici et repasser l'historique exact au sendMessage :
    // le transcript du modèle correspond alors à ce que l'utilisateur voit.
    const nextHistory = [...truncated, userMsg];
    setMessages(nextHistory);
    void sendMessage(editingText.trim(), {
      skipUserMessage: true,
      attachmentsOverride: preservedAttachments,
      historyOverride: nextHistory,
    });
  }, [editingIndex, editingText, sendMessage]);

  const handleRetry = useCallback(() => {
    const current = messagesRef.current;
    if (errorCode === "context_too_long") {
      // Auto-compaction intelligente en cas de dépassement de jetons
      const kept = current.slice(-6);
      if (kept.length < current.length) {
        setMessages(kept);
        messagesRef.current = kept;
      }
      const lastUser = [...kept].reverse().find((m) => m.role === "user");
      void sendMessage(
        lastUser
          ? `Historique condensé. Résume l'état de la conversation en 3 points puis réponds à : ${lastUser.content}`
          : "Historique condensé. Résume l'état de la conversation en 3 points.",
        { historyOverride: kept },
      );
      return;
    }
    const lastUserIdx = [...current].reverse().findIndex((m) => m.role === "user");
    if (lastUserIdx === -1) return;
    const idx = current.length - 1 - lastUserIdx;
    const lastUser = current[idx];
    // Truncate everything after the last user message (failed assistant bubble).
    const nextHistory = current.slice(0, idx + 1);
    setMessages(nextHistory);
    void sendMessage(lastUser.content, {
      skipUserMessage: true,
      attachmentsOverride: lastUser.attachments,
      historyOverride: nextHistory,
    });
  }, [errorCode, sendMessage]);

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
    setErrorCode(null);
    setEditingIndex(null);
    setEditingText("");
  }, []);

  return {
    // State
    messages,
    isLoading,
    error,
    errorCode,
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
    files,
    attachFiles,
    removeFile,
    sessionUsage,
    modelUsed,
    abortRef,
    stopStreaming,
    confirmAction,
    confirmBusy,
    batchConfirm,
    setBatchConfirm,
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
    forceScrollToBottom,
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

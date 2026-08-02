"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import { useRequestStore } from "@/hooks/use-request-store";
import { streamLLM } from "@/src/ai/cloud-engine/llm";
import { buildRequestContext } from "@/src/ai/local-engine/context";
import {
  loadAIProvider,
  loadApiKey,
  loadAiBaseUrl,
  loadAiModel,
  loadOllamaConfig,
} from "@/lib/config";
import {
  REQLY_TOOLS,
  executeToolCall,
  maskSensitiveObject,
  type ToolResult,
  type ToolCall,
} from "@/lib/llm-tools";
import {
  buildStep,
  type AssistantStep,
} from "@/src/ai/components/assistant-steps-renderer";
import type { ProcessStep } from "@/src/ai/components/assistant-steps-renderer";
import type { ChatMessage } from "@/src/ai/components/ai-sidebar-types";
import { getPermission } from "@/src/ai/agent/permissions";
import { loadRules, buildRulesSystemPrompt } from "@/src/ai/agent/rules";
import { attachmentsToPrompt } from "@/src/ai/agent/context-picker";
import { emptyUsage, addUsage } from "@/src/ai/agent/usage";
import {
  parseSlashCommand,
  createDefaultCommands,
  type SlashCommandContext,
} from "@/src/ai/agent/commands";
import type { AgentMode, ContextAttachment, AgentUsage } from "@/src/ai/agent/types";

const STALL_TIMEOUT_MS = 45_000;

export function useAiSidebarChat() {
  const pathname = usePathname();

  // ── State ─────────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assistantSteps, setAssistantSteps] = useState<AssistantStep[]>([]);

  // Editing
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");

  // Copy state
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  // ── Agent state ───────────────────────────────────────────────────────────
  const [agentMode, setAgentMode] = useState<AgentMode>("act");
  const [autoApply, setAutoApply] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<{
    planText: string;
    toolCalls: ToolCall[];
  } | null>(null);
  const [attachments, setAttachments] = useState<ContextAttachment[]>([]);
  const [sessionUsage, setSessionUsage] = useState<AgentUsage>(emptyUsage());
  const [modelUsed, setModelUsed] = useState<string | null>(null);
  const [rulesPanelOpen, setRulesPanelOpen] = useState(false);
  const [permissionsPanelOpen, setPermissionsPanelOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const confirmResolverRef = useRef<((confirmed: boolean) => void) | null>(null);

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Auto-scroll ───────────────────────────────────────────────────────────
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
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
      confirmed: boolean,
    ): Promise<ToolResult> => {
      const perm = getPermission(tc.name);
      if (perm === "deny") {
        return {
          callId: tc.callId,
          name: tc.name,
          content: "",
          error: "Outil refusé par la politique de permissions.",
        };
      }
      if (perm === "ask" && !confirmed) {
        return {
          callId: tc.callId,
          name: tc.name,
          content: "",
          error: "Confirmation requise par la politique de permissions.",
          requireConfirmation: true,
        };
      }
      return executeToolCall({ id: tc.callId, name: tc.name, arguments: tc.arguments }, { depth: 0 });
    },
    [],
  );

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isLoading) return;
      setError(null);
      const userMsg: ChatMessage = {
        role: "user",
        content: content.trim(),
        attachments: attachments.length > 0 ? attachments : undefined,
      };
      const updated = [...messages, userMsg];
      setMessages(updated);
      setInput("");
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
            copy.push({ role: "assistant", content: "", steps: [...steps] });
          }
          return copy;
        });
      };

      const addStep = (type: ProcessStep["type"], label: string) => {
        steps.push({ type, label, status: "in_progress" });
        syncSteps();
      };

      const doneStep = () => {
        if (steps.length > 0) {
          steps[steps.length - 1].status = "done";
          syncSteps();
        }
      };

      const failStep = (labelOverride?: string) => {
        if (steps.length > 0) {
          steps[steps.length - 1].status = "error";
          if (labelOverride) steps[steps.length - 1].label = labelOverride;
          syncSteps();
        }
      };

      const finishThrough = () => {
        for (const s of steps) {
          if (s.type === "through" && s.status === "in_progress") s.status = "done";
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
        const attachmentsPrompt = attachmentsToPrompt(attachments);

        const systemPrompt = [
          `Tu es un agent intégré à Reqly, dans l'esprit de Claude Code. Tu peux créer des collections, des requêtes, des environnements, et exécuter des requêtes directement.`,
          `Page: ${pathname}`,
          rulesPrompt || "Règles actives : aucune.",
          agentMode === "plan"
            ? "MODE PLAN : tu PROPOSES un plan d'actions, tu n'exécutes AUCUN outil. Décris ce que tu ferais, et listes les outils envisagés."
            : "MODE ACT : tu peux exécuter les outils disponibles pour agir.",
          autoApply
            ? "Auto-approuver : tu peux exécuter les outils sans redemander, sauf si une permission l'interdit."
            : "Avant toute action destructive, demande une confirmation explicite.",
          "Réponds en français. Sois concis et actionnable.",
        ].join("\n\n");

        const contentWithContext = [content, attachmentsPrompt].filter(Boolean).join("\n\n");

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
        }> = [];
        let retriedWithoutTools = false;

        const runTurn = async () => {
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
            previousTurns:
              previousTurns.length > 0 ? [...previousTurns] : undefined,
          };

          const stream = streamLLM(opts);
          const toolCallsThisTurn: Array<{
            callId: string;
            name: string;
            arguments: string;
          }> = [];

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
                    };
                  }
                  return copy;
                });
              } else if (token.type === "tool_calls") {
                 toolCallsThisTurn.push(
                   ...token.calls.map((c: { id: string; name: string; arguments: string }) => ({
                     callId: c.id,
                     name: c.name,
                     arguments: c.arguments,
                   })),
                 );
              }
            }
          } catch (e: any) {
            if (didTimeout) {
              steps.push({
                type: "error",
                label: "Aucune réponse du modèle (timeout).",
                status: "error",
              });
              syncSteps();
              return;
            }
            if (
              opts.tools &&
              !retriedWithoutTools &&
              /tools|functions|function calling|tool_calls|unsupported/i.test(
                e?.message ?? "",
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

          if (toolCallsThisTurn.length === 0) return;

          if (agentMode === "plan") {
            setPendingPlan({
              planText: fullText,
              toolCalls: toolCallsThisTurn.map((tc) => ({
                id: tc.callId,
                name: tc.name,
                arguments: tc.arguments,
              })),
            });
            steps.push({
              type: "error",
              label: `⏸ Mode plan — ${toolCallsThisTurn.length} action(s) proposée(s)`,
              status: "error",
            });
            syncSteps();
            return;
          }

          // Create pending steps for tool calls
          for (const tc of toolCallsThisTurn) {
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
          for (let i = 0; i < toolCallsThisTurn.length; i++) {
            const tc = toolCallsThisTurn[i];
            try {
              const result = await gatedExecute(tc, autoApply);
              const toolUsage = result.usage;
              if (toolUsage) {
                setSessionUsage((prev) => addUsage(prev, toolUsage));
              }
              results.push(result);
              steps[steps.length - toolCallsThisTurn.length + i] = {
                type: "create",
                label: `${tc.name} — ${result.error ? "❌" : "✅"}`,
                status: result.error ? "error" : "done",
              };
            } catch (e: any) {
              results.push({
                callId: tc.callId,
                name: tc.name,
                content: "",
                error: e?.message ?? "Erreur inconnue",
              });
              steps[steps.length - toolCallsThisTurn.length + i] = {
                type: "error",
                label: `${tc.name} — Erreur`,
                status: "error",
              };
            }
            syncSteps();
          }

          // Check for requireConfirmation — await user confirmation via UI buttons
          let confirmIdx = results.findIndex((r) => r.requireConfirmation);
          while (confirmIdx !== -1) {
            const targetTc = toolCallsThisTurn[confirmIdx];
            steps[steps.length - toolCallsThisTurn.length + confirmIdx] = {
              type: "create",
              label: `⚠ ${targetTc.name} — confirmation requise`,
              status: "awaiting_confirmation",
            };
            syncSteps();
            setIsLoading(false);
            const confirmed = await new Promise<boolean>((resolve) => {
              confirmResolverRef.current = resolve;
            });
            confirmResolverRef.current = null;
            if (!confirmed) {
              steps[steps.length - toolCallsThisTurn.length + confirmIdx] = {
                type: "error",
                label: `${targetTc.name} — annulé`,
                status: "error",
              };
              syncSteps();
              return;
            }
            const result = await gatedExecute(targetTc, true);
            const toolUsage = result.usage;
            if (toolUsage) {
              setSessionUsage((prev) => addUsage(prev, toolUsage));
            }
            results[confirmIdx] = result;
            steps[steps.length - toolCallsThisTurn.length + confirmIdx] = {
              type: "create",
              label: `${targetTc.name} — ${result.error ? "❌" : "✅"}`,
              status: result.error ? "error" : "done",
            };
            syncSteps();
            setIsLoading(true);
            confirmIdx = results.findIndex((r) => r.requireConfirmation);
          }

          // Store turn for multi-turn context
          previousTurns.push({
            assistantToolCalls: toolCallsThisTurn.map((tc) => ({
              id: tc.callId,
              name: tc.name,
              arguments: tc.arguments,
            })),
            toolResults: results,
          });
          turnCount++;

          if (turnCount >= MAX_TOOL_TURNS) {
            setError(
              "L'assistant a atteint la limite de 5 tours d'outils.",
            );
            return;
          }

          // Continue loop
          await runTurn();
        };

        await runTurn();

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
            };
          } else {
            copy.push({
              role: "assistant",
              content: fullText,
              steps: [...steps],
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
              copy[copy.length - 1] = { ...last, content: "⏹ Génération arrêtée.", steps: [...steps] };
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
          // Update the existing assistant bubble (created by syncSteps) instead
          // of pushing another one, so the error shows in a single message.
          setMessages((prev) => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            if (last && last.role === "assistant") {
              copy[copy.length - 1] = { ...last, content: `❌ ${msg}`, steps: [...steps] };
            } else {
              copy.push({ role: "assistant", content: `❌ ${msg}`, steps: [...steps] });
            }
            return copy;
          });
        }
      } finally {
        confirmResolverRef.current = null;
        abortRef.current = null;
        setIsLoading(false);
        setEditingIndex(null);
        setEditingText("");
      }
    },
    [messages, isLoading, pathname, agentMode, autoApply, attachments, gatedExecute],
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
    setPendingPlan(null);
    setAgentMode("act");
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser) void sendMessage(lastUser.content);
  }, [messages, sendMessage]);

  // Expose setInput for the parent to clear on new session
  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    setEditingIndex(null);
    setEditingText("");
  }, []);

  const runSlashCommand = useCallback(
    (name: string, args: string) => {
      const cmdCtx: SlashCommandContext = {
        clearMessages,
        newSession: () => {
          clearMessages();
        },
        setMode: setAgentMode,
        openRules: () => setRulesPanelOpen(true),
        openPermissions: () => setPermissionsPanelOpen(true),
        compact: () => {
          const lastUser = [...messages].reverse().find((m) => m.role === "user");
          if (lastUser) void sendMessage(`Résume la conversation puis réponds à : ${lastUser.content}`);
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

  const handleSend = useCallback(() => {
    const parsed = parseSlashCommand(input);
    if (parsed) {
      runSlashCommand(parsed.name, parsed.args);
      setInput("");
      return;
    }
    sendMessage(input);
  }, [input, sendMessage, runSlashCommand]);

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
    setMessages([...truncated, { role: "user", content: editingText.trim() }]);
    sendMessage(editingText.trim());
  }, [editingIndex, editingText, messages, sendMessage]);

  const handleRetry = useCallback(() => {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser) sendMessage(lastUser.content);
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
  }, []);

  return {
    // State
    messages,
    input,
    isLoading,
    error,
    editingIndex,
    editingText,
    copiedIndex,
    // Agent state
    agentMode,
    setAgentMode,
    autoApply,
    setAutoApply,
    pendingPlan,
    approvePlan,
    rejectPlan,
    attachments,
    setAttachments,
    attachContext,
    sessionUsage,
    modelUsed,
    abortRef,
    stopStreaming,
    confirmAction,
    runSlashCommand,
    rulesPanelOpen,
    setRulesPanelOpen,
    permissionsPanelOpen,
    setPermissionsPanelOpen,
    // Refs
    messagesEndRef,
    inputRef,
    // Actions
    setInput,
    setError,
    setMessages,
    setIsLoading,
    setEditingText,
    // Handlers
    handleSend,
    handleEditStart,
    handleEditCancel,
    handleEditConfirm,
    handleRetry,
    handleCopy,
    handleNewMessages,
    clearMessages,
    sendMessage,
  };
}

"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import { useRequestStore } from "@/hooks/use-request-store";
import { useShallow } from "zustand/react/shallow";
import { callAIText, callAITextStream } from "@/src/ai/engine/providers";
import { dispatchAIActions } from "@/src/ai/engine";
import {
  loadAIProvider,
  loadApiKey,
  loadAiBaseUrl,
  loadAiModel,
  loadOllamaConfig,
} from "@/lib/config";
import type { AIContext, CurrentRequest, TestAssertion } from "@/src/ai/engine/types";
import type { ProcessStep } from "@/src/ai/components/assistant-steps-renderer";
import type { ChatMessage } from "@/src/ai/components/ai-sidebar-types";
import { parseRequestFromMessage, parseActionsFromAIResponse } from "@/lib/ai-parse-utils";

export function useAiSidebarChat() {
  const pathname = usePathname();
  const store = useRequestStore(
    useShallow((s) => ({
      currentRequest: s.currentRequest,
      lastResponse: s.lastResponse,
      environmentVariables: s.environmentVariables,
      collectionHistory: s.collectionHistory,
      activeCollection: s.activeCollection,
      patchRequest: s.patchRequest,
      addAssertions: s.addAssertions,
      setVariable: s.setVariable,
      setDoc: s.setDoc,
      addNotification: s.addNotification,
      executeRequest: s.executeRequest,
      aiAutoApply: s.aiAutoApply ?? true,
    })),
  );

  // ── State ─────────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Editing
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");

  // Copy state
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

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
  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isLoading) return;
      setError(null);
      const userMsg: ChatMessage = { role: "user", content: content.trim() };
      const updated = [...messages, userMsg];
      setMessages(updated);
      setInput("");
      setIsLoading(true);

      // ── Step builder: accumulates process steps and syncs to the UI ──
      const steps: ProcessStep[] = [];

      try {
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

        // Step 0: through
        addStep("through", "Through...");

        // Load AI config from settings
        const provider = loadAIProvider();
        const apiKey = loadApiKey(provider);
        const aiModel = loadAiModel(provider);
        const aiBaseUrl = loadAiBaseUrl(provider);
        const ollamaConfig = loadOllamaConfig();

        const aiConfig = {
          provider,
          apiKey,
          model: aiModel || undefined,
          openaiUrl:
            provider === "openai" || provider === "custom" ? aiBaseUrl || undefined : undefined,
          ollamaUrl:
            provider === "ollama"
              ? `http://${ollamaConfig.host || "127.0.0.1"}:${ollamaConfig.port ?? 11434}`
              : undefined,
        };

        // Parse method + URL from user message
        const parsed = parseRequestFromMessage(content);

        // Build actions from parsed data
        const actions: import("@/src/ai/engine/types").AIAction[] = [];

        if (parsed) {
          actions.push({
            type: "FILL_REQUEST",
            payload: {
              method: parsed.method as any,
              url: parsed.url,
              reason: `Set request from user message`,
            },
          });
          doneStep(); // through done

          addStep("fill", `Création de requête ${parsed.method} ${parsed.url}`);

          const wantsExecute =
            /\b(exécute|exécuter|lance|lancer|execute|run|go|envoie|envoyer)\b/i.test(content);
          if (wantsExecute) {
            doneStep(); // fill done
            addStep("execute", `Exécution ${parsed.method} ${parsed.url}`);
            actions.push({
              type: "EXECUTE_REQUEST",
              payload: {
                method: parsed.method as any,
                url: parsed.url,
                reason: `Execute ${parsed.method} ${parsed.url}`,
              },
            });
          }
        }

        // Dispatch actions to control the app
        if (actions.length > 0) {
          const handlers = {
            setRequest: async (patch: any) => {
              store.patchRequest?.(patch);
            },
            addAssertions: async (assertions: any) => {
              store.addAssertions?.(assertions);
            },
            setVariable: async (name: string, value: string, description?: string) => {
              store.setVariable?.(name, value, description);
            },
            applyFix: async (patch: any) => {
              store.patchRequest?.(patch);
            },
            setDoc: async (markdown: string, title?: string) => {
              store.setDoc?.(markdown, title);
            },
            notify: async (message: string) => {
              store.addNotification?.({ title: "Assistant IA", body: message, type: "info" });
            },
            executeRequest: async (request: any) => {
              if (request) {
                store.patchRequest?.(request);
                return store.executeRequest?.(request);
              }
              return undefined;
            },
            runBatch: async () => [] as any[],
            audit: async () => {},
          };

          const ctx: AIContext = {
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

          try {
            const dispatchResult = await dispatchAIActions(actions, handlers, ctx, {
              allowAutoApply: Boolean(store.aiAutoApply),
            });

            if (dispatchResult.blocked.length > 0) {
              const blockMsg =
                "❌ Exécution bloquée — active 'Autoriser l'IA à appliquer automatiquement' dans les Settings.";
              failStep(blockMsg);
              setError(
                "Action bloquée : l'application automatique n'est pas activée. Active-la dans Settings > IA.",
              );
            } else {
              doneStep(); // mark last step (fill or execute) as done
            }
          } catch (e) {
            failStep();
            throw e;
          }
        } else {
          doneStep(); // through done (no actions to dispatch)
        }

        // Get fresh state AFTER actions have been dispatched
        const fresh = useRequestStore.getState();
        const responseCtx = {
          currentRequest: fresh.currentRequest ?? {
            method: "GET",
            url: "",
            headers: {},
            params: {},
          },
          lastResponse: fresh.lastResponse ?? null,
          environmentVariables: fresh.environmentVariables ?? {},
          collectionHistory: (fresh.collectionHistory ?? []).slice(0, 10),
          activeCollection: fresh.activeCollection ?? null,
        };

        const executedLabel =
          actions.length > 0
            ? `\n\nRésultat de l'action exécutée :\n${JSON.stringify(responseCtx.lastResponse, null, 2)}`
            : "";

        addStep("through", "Génération de la réponse...");

        const systemPrompt = `Page: ${pathname}
Context: ${JSON.stringify(responseCtx, null, 2)}${executedLabel}

User request: ${content}

Respond in French. If you executed or modified a request, explain what was done. If the user asked a question, answer it. Be concise and helpful.

IMPORTANT — When you describe a request (made or suggested), ALWAYS include a JSON block at the end of your response with the exact method and URL:
\`\`\`json
{
  "method": "GET",
  "url": "https://example.com/api"
}
\`\`\`
This lets the system execute the actual request you described.`;

        // ── Streaming response ──────────────────────────────────────
        // Insert an empty assistant message that will be progressively filled.
        const assistantIndex = messages.length; // index in the next state after push
        setMessages((prev) => [...prev, { role: "assistant", content: "", steps: [...steps] }]);

        let streamedText = "";
        const onToken = (token: string) => {
          streamedText += token;
          // Update the last assistant message with accumulated text
          setMessages((prev) => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            if (last && last.role === "assistant") {
              copy[copy.length - 1] = { ...last, content: streamedText, steps: [...steps] };
            }
            return copy;
          });
        };

        await callAITextStream(content, { ...aiConfig, system: systemPrompt }, onToken);
        doneStep(); // réponse générée

        // ── Post-AI actions (JSON block detection) ───────────────────
        // If no actions were dispatched by regex, try parsing the AI's
        // response for structured action data (method + URL in a JSON block).
        let finalContent = streamedText;

        if (actions.length === 0) {
          const aiActions = parseActionsFromAIResponse(streamedText);
          if (aiActions && aiActions.length > 0) {
            const a = aiActions[0];
            addStep("fill", `Création de requête ${a.method} ${a.url}`);

            const postActions: import("@/src/ai/engine/types").AIAction[] = [
              {
                type: "FILL_REQUEST",
                payload: {
                  method: a.method as any,
                  url: a.url,
                  reason: `AI detected: ${a.method} ${a.url}`,
                },
              },
              {
                type: "EXECUTE_REQUEST",
                payload: {
                  method: a.method as any,
                  url: a.url,
                  reason: `Execute ${a.method} ${a.url}`,
                },
              },
            ];

            try {
              doneStep(); // fill done
              addStep("execute", `Exécution ${a.method} ${a.url}`);

              const postCtx: AIContext = {
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

              const dispatchResult = await dispatchAIActions(
                postActions,
                {
                  setRequest: async (patch: any) => {
                    store.patchRequest?.(patch);
                  },
                  addAssertions: async () => {},
                  setVariable: async () => {},
                  applyFix: async (patch: any) => {
                    store.patchRequest?.(patch);
                  },
                  setDoc: async () => {},
                  notify: async (message: string) => {
                    store.addNotification?.({ title: "Assistant IA", body: message, type: "info" });
                  },
                  executeRequest: async (request: any) => {
                    if (request) {
                      store.patchRequest?.(request);
                      return store.executeRequest?.(request);
                    }
                    return undefined;
                  },
                  runBatch: async () => [] as any[],
                  audit: async () => {},
                },
                postCtx,
                { allowAutoApply: Boolean(store.aiAutoApply) },
              );

              if (dispatchResult.blocked.length > 0) {
                const blockMsg =
                  "❌ Exécution bloquée — active 'Autoriser l'IA à appliquer automatiquement' dans les Settings.";
                failStep(blockMsg);
                setError(
                  "Action bloquée : l'application automatique n'est pas activée. Active-la dans Settings > IA.",
                );
              } else {
                doneStep(); // execute done
                const fresh2 = useRequestStore.getState();
                const status = fresh2.lastResponse?.status ?? "?";
                const durationMs = fresh2.lastResponse?.durationMs ?? 0;
                finalContent =
                  streamedText +
                  `\n\n✅ Requête \`${a.method} ${a.url}\` exécutée — status ${status} (${durationMs}ms)`;
              }
            } catch (e) {
              failStep();
              console.error("[ai-sidebar] post-AI action dispatch failed:", e);
            }
          }
        }

        // ── Set final content ────────────────────────────────────────
        setMessages((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last && last.role === "assistant") {
            copy[copy.length - 1] = { ...last, content: finalContent, steps: [...steps] };
          } else {
            copy.push({ role: "assistant", content: finalContent, steps: [...steps] });
          }
          return copy;
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erreur de communication avec l'IA";
        setError(msg);
        steps.push({ type: "error", label: "Erreur", status: "error" });
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `❌ ${msg}`, steps: [...steps] },
        ]);
      } finally {
        setIsLoading(false);
        setEditingIndex(null);
        setEditingText("");
      }
    },
    [messages, isLoading, pathname, store],
  );

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleSend = useCallback(() => {
    sendMessage(input);
  }, [input, sendMessage]);

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

  // Expose setInput for the parent to clear on new session
  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    setEditingIndex(null);
    setEditingText("");
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

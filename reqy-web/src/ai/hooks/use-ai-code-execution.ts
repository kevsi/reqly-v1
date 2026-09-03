"use client";

import { useState, useCallback } from "react";
import type { ParsedCodeRequest } from "@/src/ai/agent/code-request";
import type { ChatMessage } from "@/src/ai/components/ai-sidebar-types";
import type { ProcessStep } from "@/src/ai/components/assistant-steps-renderer";
import type { ToolResult } from "@/lib/llm-tools";
import type { ApprovalSource } from "@/src/ai/agent/permissions";
import i18n from "@/src/i18n";

interface UseAiCodeExecutionParams {
  gatedExecute: (
    tc: { callId: string; name: string; arguments: string },
    approval?: ApprovalSource,
  ) => Promise<ToolResult>;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
}

/**
 * Hook dédié à l'exécution de requêtes HTTP détectées dans les cartes de code.
 * Permet de passer en revue la requête avant exécution manuelle confirmée.
 */
export function useAiCodeExecution({ gatedExecute, setMessages }: UseAiCodeExecutionParams) {
  const [pendingCodeRequest, setPendingCodeRequest] = useState<ParsedCodeRequest | null>(null);
  const [isExecutingCode, setIsExecutingCode] = useState(false);

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
  }, [gatedExecute, isExecutingCode, pendingCodeRequest, setMessages]);

  return {
    pendingCodeRequest,
    isExecutingCode,
    requestCodeExecution,
    cancelCodeExecution,
    confirmCodeExecution,
  };
}

"use client";

import { useState, useEffect, useCallback } from "react";
import { persistence } from "@/lib/persistence";
import { emptyUsage, mergeUsages } from "@/src/ai/agent/usage";
import type { ChatMessage, ConversationSession } from "@/src/ai/components/ai-sidebar-types";

const HISTORY_KEY = "ai-sidebar-history";
const MAX_HISTORY = 50;

export function useAiSidebarHistory(messages: ChatMessage[], model?: string | null) {
  const [sessions, setSessions] = useState<ConversationSession[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = persistence.getItem<ConversationSession[]>(HISTORY_KEY);
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  });
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : messages.length === 0 ? crypto.randomUUID() : null,
  );
  const [historyOpen, setHistoryOpen] = useState(false);

  // Save messages to current session — debounced to avoid heavy writes
  // on every streamed token. Writes happen at most once per 800ms, plus
  // a trailing write 800ms after the last change (covers stream end).
  useEffect(() => {
    if (!currentSessionId || messages.length === 0) return;

    const timer = setTimeout(() => {
      setSessions((prev) => {
        const existing = prev.find((s) => s.id === currentSessionId);
        const totalUsage = mergeUsages(
          messages.filter((m) => m.role === "assistant").map((m) => m.usage ?? emptyUsage()),
        );
        let updated: ConversationSession[];

        if (existing) {
          updated = prev.map((s) =>
            s.id === currentSessionId
              ? {
                  ...s,
                  messages,
                  totalUsage,
                  model: s.model ?? model ?? undefined,
                  updatedAt: new Date().toISOString(),
                }
              : s,
          );
        } else {
          const title =
            messages.find((m) => m.role === "user")?.content.slice(0, 50) ||
            "Nouvelle conversation";
          updated = [
            ...prev,
            {
              id: currentSessionId,
              title: title.length > 40 ? title.slice(0, 37) + "..." : title,
              messages,
              totalUsage,
              model: model ?? undefined,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ];
        }

        const trimmed = updated.slice(-MAX_HISTORY);
        persistence.setItem(HISTORY_KEY, trimmed);
        return trimmed;
      });
    }, 800);

    return () => clearTimeout(timer);
  }, [messages, currentSessionId, model]);

  const handleNewSession = useCallback(() => {
    setCurrentSessionId(crypto.randomUUID());
    setHistoryOpen(false);
  }, []);

  const handleSelectSession = useCallback((session: ConversationSession) => {
    setCurrentSessionId(session.id);
    setHistoryOpen(false);
  }, []);

  const handleLoadSessionMessages = useCallback(
    (session: ConversationSession, onLoad: (msgs: ChatMessage[]) => void) => {
      setCurrentSessionId(session.id);
      setHistoryOpen(false);
      onLoad(session.messages);
    },
    [],
  );

  const handleDeleteSession = useCallback(
    (id: string) => {
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (currentSessionId === id) {
        setCurrentSessionId(crypto.randomUUID());
      }
    },
    [currentSessionId],
  );

  return {
    sessions,
    currentSessionId,
    historyOpen,
    setHistoryOpen,
    handleNewSession,
    handleSelectSession,
    handleLoadSessionMessages,
    handleDeleteSession,
  };
}

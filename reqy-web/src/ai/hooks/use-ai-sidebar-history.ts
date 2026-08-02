"use client";

import { useState, useEffect, useCallback } from "react";
import { persistence } from "@/lib/persistence";
import { emptyUsage, mergeUsages } from "@/src/ai/agent/usage";
import type { ChatMessage, ConversationSession } from "@/src/ai/components/ai-sidebar-types";

const HISTORY_KEY = "ai-sidebar-history";
const MAX_HISTORY = 50;

export function useAiSidebarHistory(messages: ChatMessage[], model?: string | null) {
  const [sessions, setSessions] = useState<ConversationSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Load sessions on mount
  useEffect(() => {
    try {
      const raw = persistence.getItem<ConversationSession[]>(HISTORY_KEY);
      if (raw && Array.isArray(raw)) setSessions(raw);
    } catch {
      /* ignore */
    }
  }, []);

  const saveSessions = useCallback((updated: ConversationSession[]) => {
    setSessions(updated);
    persistence.setItem(HISTORY_KEY, updated.slice(0, MAX_HISTORY));
  }, []);

  // Track current session automatically — create one if none exists and no messages
  useEffect(() => {
    if (!currentSessionId && messages.length === 0) {
      setCurrentSessionId(crypto.randomUUID());
    }
  }, [currentSessionId, messages.length]);

  // Save messages to current session whenever they change
  useEffect(() => {
    if (!currentSessionId || messages.length === 0) return;

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
          messages.find((m) => m.role === "user")?.content.slice(0, 50) || "Nouvelle conversation";
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

      persistence.setItem(HISTORY_KEY, updated.slice(0, MAX_HISTORY));
      return updated;
    });
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

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
  const sessionsRef = useRef(sessions);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  // Save messages to the current session. A leading-edge write fires as soon as
  // a new turn appears (so a mid-stream reload never loses the whole exchange),
  // and a trailing write consolidates streaming tokens 800ms after the last one.
  const lastWriteLenRef = useRef(-1);
  useEffect(() => {
    if (!currentSessionId || messages.length === 0) return;

    const build = (list: ConversationSession[]): ConversationSession[] => {
      // `phase` est un état transitoire de rendu (tool_calling / awaiting_response /
      // streaming / done) : on ne le persiste pas, sinon une session rechargée
      // afficherait un indicateur « typing » bloqué sur un message terminé.
      const persistableMessages = messages.map(({ phase: _phase, ...rest }) => rest);
      const existing = list.find((s) => s.id === currentSessionId);
      const totalUsage = mergeUsages(
        persistableMessages
          .filter((m) => m.role === "assistant")
          .map((m) => m.usage ?? emptyUsage()),
      );
      if (existing) {
        return list.map((s) =>
          s.id === currentSessionId
            ? {
                ...s,
                messages: persistableMessages,
                totalUsage,
                model: s.model ?? model ?? undefined,
                updatedAt: new Date().toISOString(),
              }
            : s,
        );
      }
      const title =
        persistableMessages.find((m) => m.role === "user")?.content.slice(0, 50) ||
        "Nouvelle conversation";
      return [
        ...list,
        {
          id: currentSessionId,
          title: title.length > 40 ? title.slice(0, 37) + "..." : title,
          messages: persistableMessages,
          totalUsage,
          model: model ?? undefined,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];
    };

    const write = () => {
      const next = build(sessionsRef.current).slice(-MAX_HISTORY);
      lastWriteLenRef.current = messages.length;
      setSessions(next);
      void persistence.setItem(HISTORY_KEY, next);
    };

    if (messages.length > lastWriteLenRef.current) {
      write(); // leading edge: persist the new turn immediately
    }
    const timer = setTimeout(write, 800); // trailing consolidation
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
      const next = sessionsRef.current.filter((s) => s.id !== id);
      void persistence.setItem(HISTORY_KEY, next.slice(-MAX_HISTORY));
      setSessions(next);
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

/**
 * Phase 5.4 — useChatHistory hook (local-storage backed)
 *
 * Loads, appends, and clears chat history for a given request identifier.
 * Uses localStorage so no external service (Supabase) is required.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { persistence } from "@/lib/persistence";

export type ChatRole = "user" | "assistant";

export interface ChatMessageRecord {
  id: string;
  request_id: string;
  role: ChatRole;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface UseChatHistoryResult {
  messages: ChatMessageRecord[];
  loading: boolean;
  error: string | null;
  authenticated: boolean;
  refetch: () => Promise<void>;
  append: (
    role: ChatRole,
    content: string,
    metadata?: Record<string, unknown>
  ) => Promise<ChatMessageRecord | null>;
  clear: (id?: string) => Promise<void>;
}

function storageKey(requestId: string) {
  return `chat-history:${requestId}`;
}

function loadFromStorage(requestId: string): ChatMessageRecord[] {
  try {
    const raw = persistence.getItem<string>(storageKey(requestId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveToStorage(requestId: string, messages: ChatMessageRecord[]) {
  try {
    void persistence.setItem(storageKey(requestId), JSON.stringify(messages));
  } catch {
    // storage full or unavailable — silently ignore
  }
}

let idCounter = 0;
function nextId() {
  return `local-${Date.now()}-${++idCounter}`;
}

/**
 * @param requestId Identifier for the request. Pass null to skip fetching.
 * @param options.enabled Set false to disable fetching (e.g. during streaming).
 */
export function useChatHistory(
  requestId: string | null,
  options: { enabled?: boolean } = {}
): UseChatHistoryResult {
  const enabled = options.enabled !== false;
  const [messages, setMessages] = useState<ChatMessageRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!requestId || !enabled) {
      setMessages([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = loadFromStorage(requestId);
      setMessages(data);
    } catch (e: any) {
      setError(e?.message ?? "Erreur de chargement de l'historique");
    } finally {
      setLoading(false);
    }
  }, [requestId, enabled]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const append = useCallback(
    async (
      role: ChatRole,
      content: string,
      metadata: Record<string, unknown> = {}
    ): Promise<ChatMessageRecord | null> => {
      if (!requestId) return null;
      const record: ChatMessageRecord = {
        id: nextId(),
        request_id: requestId,
        role,
        content,
        metadata,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => {
        const next = [...prev, record];
        saveToStorage(requestId, next);
        return next;
      });
      return record;
    },
    [requestId]
  );

  const clear = useCallback(
    async (id?: string) => {
      if (!requestId) return;
      setMessages((prev) => {
        const next = id ? prev.filter((m) => m.id !== id) : [];
        saveToStorage(requestId, next);
        return next;
      });
    },
    [requestId]
  );

  return { messages, loading, error, authenticated: true, refetch, append, clear };
}

/**
 * Compute a stable request identifier from method+url. Used as the chat
 * history partition key so each request has its own conversation thread.
 */
export function computeRequestId(method: string, url: string): string {
  const m = (method || "GET").toUpperCase();
  const cleaned = (url || "").trim().toLowerCase();
  return `${m}::${cleaned}`;
}

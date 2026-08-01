"use client";

/**
 * Domain hook: history — typed Zustand selector with workspace filtering.
 *
 * Usage:
 *   const { history, clearHistory, removeFromHistory } = useHistory();
 *   const { history: all } = useHistory({ scoped: false });
 */

import { useRequestStore } from "@/hooks/use-request-store";
import type { HistoryItem, HttpMethod } from "@/hooks/request-types";
import { WORKSPACE_PERSONAL_ID } from "@/hooks/store/types";

export interface UseHistoryOptions {
  /** Filter history to the active workspace (default: true). */
  scoped?: boolean;
  /** Maximum number of items to return (default: no limit). */
  limit?: number;
}

export function useHistory(options: UseHistoryOptions = {}) {
  const { scoped = true, limit } = options;

  const history = useRequestStore((s) => {
    let items = s.history;
    if (scoped) {
      const wsId = s.activeWorkspaceId ?? WORKSPACE_PERSONAL_ID;
      items = items.filter((h) => h.workspaceId === wsId);
    }
    return limit ? items.slice(0, limit) : items;
  });

  const addToHistory = useRequestStore((s) => s.addToHistory);
  const addHistoryAndNotify = useRequestStore((s) => s.addHistoryAndNotify);
  const clearHistory = useRequestStore((s) => s.clearHistory);
  const removeFromHistory = useRequestStore((s) => s.removeFromHistory);

  const executeRequest = useRequestStore((s) => s.executeRequest);
  const executeRequestById = useRequestStore((s) => s.executeRequestById);

  const recentByMethod = (method: HttpMethod, count = 5): HistoryItem[] =>
    history.filter((h) => h.method === method).slice(0, count);

  return {
    history,
    addToHistory,
    addHistoryAndNotify,
    clearHistory,
    removeFromHistory,
    executeRequest,
    executeRequestById,
    recentByMethod,
  };
}

"use client";

/**
 * useRunnerRunLifecycle — état du run du Runner : modal, progression, rapport,
 * historique persisté (5 derniers runs) et garde-fous (abort au démontage,
 * avertissement avant fermeture d'onglet).
 * (extrait de page.tsx lors de la passe de dé-vibecodage)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { CollectionRunReport } from "@/lib/test-runner/types";
import { persistence } from "@/lib/persistence";

const RUN_HISTORY_KEY = "reqly-runner-run-history";
const RUN_HISTORY_LIMIT = 5;

interface StoredRunEntry {
  savedAt: number;
  report: CollectionRunReport;
}


export function useRunnerRunLifecycle() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentExecutingName, setCurrentExecutingName] = useState<string | null>(null);
  const [report, setReport] = useState<CollectionRunReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filterTab, setFilterTab] = useState<string>("all");
  // R15: completed/total pour le label honnête "Terminée : X (n/total)"
  const [progressCounts, setProgressCounts] = useState<{ completed: number; total: number } | null>(
    null,
  );
  const [runHistory, setRunHistory] = useState<StoredRunEntry[]>([]);
  const runHistoryRef = useRef<StoredRunEntry[]>([]);
  // Le rapport affiché est un run historique rechargé (lecture seule).
  const [isHistoricalView, setIsHistoricalView] = useState(false);

  const runAbortControllerRef = useRef<AbortController | null>(null);

  // R7b: abort de tout run en vol au démontage
  useEffect(
    () => () => {
      runAbortControllerRef.current?.abort();
    },
    [],
  );

  // R7a: avertir avant fermeture de l'onglet pendant un run
  useEffect(() => {
    if (!isRunning) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isRunning]);

  // R7c: chargement de l'historique une fois la persistance prête
  useEffect(() => {
    let cancelled = false;
    void persistence
      .waitForReady()
      .then(() => {
        if (cancelled) return;
        const stored = persistence.getItem<StoredRunEntry[]>(RUN_HISTORY_KEY);
        if (Array.isArray(stored)) {
          const entries = stored.filter((e) => e && e.report).slice(0, RUN_HISTORY_LIMIT);
          runHistoryRef.current = entries;
          setRunHistory(entries);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const persistRunReport = useCallback((rep: CollectionRunReport) => {
    const entry: StoredRunEntry = { savedAt: Date.now(), report: rep };
    const next = [entry, ...runHistoryRef.current].slice(0, RUN_HISTORY_LIMIT);
    runHistoryRef.current = next;
    setRunHistory(next);
    void persistence.setItem(RUN_HISTORY_KEY, next);
  }, []);

  const loadHistoricalRun = useCallback(
    (savedAt: string) => {
      if (isRunning) return;
      const entry = runHistory.find((e) => String(e.savedAt) === savedAt);
      if (!entry) return;
      setIsHistoricalView(true);
      setError(null);
      setFilterTab("all");
      setReport(entry.report);
      setIsModalOpen(true);
    },
    [isRunning, runHistory],
  );

  const handleCancel = useCallback(() => {
    runAbortControllerRef.current?.abort();
  }, []);

  return {
    isModalOpen,
    setIsModalOpen,
    isRunning,
    setIsRunning,
    progress,
    setProgress,
    currentExecutingName,
    setCurrentExecutingName,
    report,
    setReport,
    error,
    setError,
    filterTab,
    setFilterTab,
    progressCounts,
    setProgressCounts,
    isHistoricalView,
    setIsHistoricalView,
    runHistory,
    runAbortControllerRef,
    persistRunReport,
    loadHistoricalRun,
    handleCancel,
  };
}

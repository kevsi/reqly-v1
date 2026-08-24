"use client";

/**
 * Cœur des Monitors MVP : CRUD persistant, exécution via le test-runner
 * existant, évaluation pass/degraded/fail, historique plafonné, scheduler à
 * tick (15 s) qui ne tourne que lorsque l'onglet est visible, et webhooks sur
 * transition d'état uniquement (anti-bruit : échec / dégradé / rétabli).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { runCollection } from "@/lib/test-runner/runner";
import { createProxyExecutor } from "@/lib/test-runner/proxy-executor";
import type { Collection, RequestItem } from "@/lib/types";
import type { CollectionRunReport } from "@/lib/test-runner/types";
import {
  loadHistory,
  loadMonitors,
  saveHistory,
  saveMonitors,
  requestToMonitorRequest,
  type Monitor,
  type MonitorHttpRequest,
  type MonitorRunRecord,
  type MonitorRunStatus,
} from "@/lib/monitors/types";
import {
  acquireLeadership,
  refreshLeadership,
  releaseLeadership,
} from "@/lib/monitors/tab-lock";
import { maybeAlertPayload, sendMonitorWebhook } from "@/lib/monitors/alerts";
import {
  buildNativeAssertions,
  evaluateMonitorResults,
} from "@/lib/monitors/shared";

const SCHEDULER_TICK_MS = 15_000;
const LEADER_HEARTBEAT_MS = 5_000;
const RETRY_DELAY_MS = 2_000;
const MAX_ATTEMPTS = 3;

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function evaluate(
  report: CollectionRunReport,
  checks: Monitor["checks"],
): { status: MonitorRunStatus; checksOut: MonitorRunRecord["checks"] } {
  const { status, checksOut } = evaluateMonitorResults(
    report.results.map((r) => ({
      requestId: r.requestId,
      name: r.requestName,
      runnerStatus: r.status,
      statusCode: r.statusCode,
      responseTimeMs: r.responseTimeMs,
      responseBodyPreview: r.responseBodyPreview,
      responseHeaders: r.responseHeaders,
      error: r.error,
    })),
    checks,
  );
  return { status, checksOut };
}

export function useMonitors(collections: Collection[]) {
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [history, setHistory] = useState<MonitorRunRecord[]>([]);
  /** Prochain déclenchement planifié par monitor (epoch ms). */
  const [nextRunAt, setNextRunAt] = useState<Record<string, number>>({});
  const inFlightRef = useRef<Map<string, Promise<MonitorRunRecord | null>>>(new Map());
  const monitorsRef = useRef<Monitor[]>([]);
  const historyRef = useRef<MonitorRunRecord[]>([]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration from storage (SSR-safe)
    setMonitors(loadMonitors());
    setHistory(loadHistory());
  }, []);

  useEffect(() => {
    monitorsRef.current = monitors;
  }, [monitors]);
  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  // ── Persistance ────────────────────────────────────────────────────────
  const commitMonitors = useCallback((next: Monitor[]) => {
    setMonitors(next);
    saveMonitors(next);
  }, []);

  const addMonitor = useCallback(
    (data: Omit<Monitor, "id" | "createdAt" | "updatedAt">): Monitor => {
      const now = Date.now();
      const monitor: Monitor = { ...data, id: newId("mon"), createdAt: now, updatedAt: now };
      commitMonitors([monitor, ...monitorsRef.current]);
      return monitor;
    },
    [commitMonitors],
  );

  const updateMonitor = useCallback(
    (id: string, patch: Partial<Omit<Monitor, "id" | "createdAt">>) => {
      commitMonitors(
        monitorsRef.current.map((m) =>
          m.id === id ? { ...m, ...patch, updatedAt: Date.now() } : m,
        ),
      );
      // Un changement invalide la planification précédente.
      setNextRunAt((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
    [commitMonitors],
  );

  const removeMonitor = useCallback(
    (id: string) => {
      commitMonitors(monitorsRef.current.filter((m) => m.id !== id));
      // Purge l'historique orphelin pour ne pas gonfler le stockage local.
      const nextHistory = historyRef.current.filter((h) => h.monitorId !== id);
      setHistory(nextHistory);
      saveHistory(nextHistory);
      setNextRunAt((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
    [commitMonitors],
  );

  // ── Exécution ─────────────────────────────────────────────────────────
  const executeMonitorRun = useCallback(
    async (monitor: Monitor): Promise<MonitorRunRecord | null> => {
      // Le runner consomme des RequestItem : reconstituer le minimum viable,
      // avec les assertions natives issues de la config du monitor.
      const nativeAssertions = buildNativeAssertions(monitor);
      const requests: RequestItem[] = monitor.requests.map((r) => ({
        id: r.id,
        name: r.name,
        method: r.method as RequestItem["method"],
        url: r.url,
        endpoint: r.url,
        headers: r.headers,
        body: r.body,
        createdAt: 0,
        updatedAt: 0,
        ...(nativeAssertions.length > 0
          ? ({ runnerAssertions: nativeAssertions } as Partial<RequestItem>)
          : {}),
      }));
      const pseudoCollection: Collection = {
        id: `monitor-${monitor.id}`,
        name: monitor.name,
        color: "#000000",
        icon: "activity",
        requests,
        createdAt: 0,
        updatedAt: 0,
      };

      // Retry anti-faux-positifs (spec v1.5) : jusqu'à MAX_ATTEMPTS essais sur
      // échec, délai fixe entre essais. Seul le verdict final est historisé.
      let report: CollectionRunReport | null = null;
      let attempts = 0;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        attempts = attempt;
        try {
          report = await runCollection(
            pseudoCollection,
            {
              environment: {},
              iterationData: {},
              iterationIndex: 0,
              log: () => {},
            },
            {
              executor: createProxyExecutor(),
              perRequestTimeoutMs: 30_000,
              scriptTimeoutMs: 5_000,
              disableScripts: true,
            },
          );
        } catch {
          report = null;
        }
        if (!report) return null; // réseau/annulation : silencieux, pas de bruit
        const { status } = evaluate(report, monitor.checks);
        if (status !== "fail" || attempt === MAX_ATTEMPTS) break;
        await new Promise((resolve) => window.setTimeout(resolve, RETRY_DELAY_MS));
      }
      if (!report) return null;

      const { status, checksOut } = evaluate(report, monitor.checks);
      const record: MonitorRunRecord = {
        id: newId("run"),
        monitorId: monitor.id,
        at: Date.now(),
        status,
        durationMs: report.totalDurationMs,
        checks: checksOut,
        ...(attempts > 1 ? { retries: attempts - 1 } : {}),
      };

      const previousRuns = historyRef.current;
      const nextHistory = [record, ...previousRuns];
      setHistory(nextHistory);
      saveHistory(nextHistory);

      // ── Webhook sur transition uniquement ────────────────────────────
      if (monitor.webhookUrl?.trim()) {
        const lastForMonitor = previousRuns.find(
          (h) => h.monitorId === monitor.id,
        );
        const alert = maybeAlertPayload(
          monitor,
          record,
          checksOut,
          lastForMonitor?.status,
        );
        if (alert) {
          void sendMonitorWebhook(monitor.webhookUrl.trim(), alert.payload);
        }
      }

      return record;
    },
    [],
  );

  const runMonitor = useCallback(
    async (monitor: Monitor): Promise<MonitorRunRecord | null> => {
      if (monitor.requests.length === 0) return null;
      // Verrou par promesse : un run long ne peut jamais être doublonné par
      // le scheduler (contrairement à un verrou à TTL fixe).
      const inflight = inFlightRef.current.get(monitor.id);
      if (inflight) return inflight;
      const promise = executeMonitorRun(monitor);
      inFlightRef.current.set(monitor.id, promise);
      try {
        return await promise;
      } catch {
        return null;
      } finally {
        inFlightRef.current.delete(monitor.id);
      }
    },
    [executeMonitorRun],
  );

  // ── Leadership multi-onglets ──────────────────────────────────────────
  const [isLeader, setIsLeader] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- élection initiale (storage externe)
    setIsLeader(acquireLeadership());
    const handle = window.setInterval(() => {
      setIsLeader(refreshLeadership());
    }, LEADER_HEARTBEAT_MS);
    return () => {
      window.clearInterval(handle);
      releaseLeadership();
    };
  }, []);

  // Sync inter-onglets : recharge monitors/historique si modifiés ailleurs.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === "reqly-monitors-v1") setMonitors(loadMonitors());
      if (e.key === "reqly-monitor-history-v1") setHistory(loadHistory());
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // ── Scheduler ─────────────────────────────────────────────────────────
  const isLeaderRef = useRef(false);
  useEffect(() => {
    isLeaderRef.current = isLeader;
  }, [isLeader]);
  useEffect(() => {
    const tick = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      // Un seul onglet déclenche les exécutions planifiées (Run manuel : tout
      // onglet). Évite runs doublés et courses d'écriture localStorage.
      if (!isLeaderRef.current) return;
      const now = Date.now();
      for (const monitor of monitorsRef.current) {
        if (!monitor.enabled || monitor.requests.length === 0) continue;
        const scheduledAt = nextRunAt[monitor.id];
        const isOverdue = scheduledAt == null || now >= scheduledAt;
        const isInflight = inFlightRef.current.has(monitor.id);
        if (isOverdue && !isInflight) {
          setNextRunAt((prev) => ({ ...prev, [monitor.id]: now + monitor.intervalSec * 1000 }));
          void runMonitor(monitor);
        }
      }
    };
    tick();
    const handle = window.setInterval(tick, SCHEDULER_TICK_MS);
    return () => window.clearInterval(handle);
  }, [nextRunAt, runMonitor]);

  const historyByMonitor = useMemo(() => {
    const map = new Map<string, MonitorRunRecord[]>();
    for (const record of history) {
      const list = map.get(record.monitorId);
      if (list) list.push(record);
      else map.set(record.monitorId, [record]);
    }
    return map;
  }, [history]);

  // ── Génération automatique depuis les collections ─────────────────────
  const generateFromCollections = useCallback(
    (collectionIds: string[], intervalSec: Monitor["intervalSec"], checks: Monitor["checks"], webhookUrl?: string): number => {
      let created = 0;
      const existingNames = new Set(monitorsRef.current.map((m) => m.name));
      const next = [...monitorsRef.current];
      for (const collection of collections) {
        if (!collectionIds.includes(collection.id)) continue;
        const requests: MonitorHttpRequest[] = collection.requests.map(requestToMonitorRequest);
        if (requests.length === 0) continue;
        if (existingNames.has(collection.name)) continue; // pas de doublon
        existingNames.add(collection.name);
        const now = Date.now();
        next.unshift({
          id: newId("mon"),
          name: collection.name,
          enabled: true,
          intervalSec,
          checks,
          ...(webhookUrl?.trim() ? { webhookUrl: webhookUrl.trim() } : {}),
          requests,
          createdAt: now,
          updatedAt: now,
        });
        created += 1;
      }
      if (created > 0) commitMonitors(next);
      return created;
    },
    [collections, commitMonitors],
  );

  /**
   * Monitors depuis les routes détectées par le scanner (projets my-projects).
   * Les routes n'ont pas d'hôte : un baseUrl par lot est requis.
   */
  const generateFromScannedProjects = useCallback(
    (
      projects: Array<{ id: string; name: string; port?: number }>,
      resolveRoutes: (projectId: string) => MonitorHttpRequest[],
      baseUrlByProject: Record<string, string>,
      intervalSec: Monitor["intervalSec"],
      checks: Monitor["checks"],
      webhookUrl?: string,
    ): number => {
      let created = 0;
      const existingNames = new Set(monitorsRef.current.map((m) => m.name));
      const next = [...monitorsRef.current];
      for (const project of projects) {
        const base = (baseUrlByProject[project.id] ?? "").trim().replace(/\/+$/, "");
        if (!base || !/^https?:\/\//i.test(base)) continue;
        const requests = resolveRoutes(project.id);
        if (requests.length === 0) continue;
        if (existingNames.has(project.name)) continue;
        existingNames.add(project.name);
        const now = Date.now();
        next.unshift({
          id: newId("mon"),
          name: project.name,
          enabled: true,
          intervalSec,
          checks,
          ...(webhookUrl?.trim() ? { webhookUrl: webhookUrl.trim() } : {}),
          requests,
          createdAt: now,
          updatedAt: now,
        });
        created += 1;
      }
      if (created > 0) commitMonitors(next);
      return created;
    },
    [commitMonitors],
  );

  return {
    monitors,
    history,
    historyByMonitor,
    nextRunAt,
    addMonitor,
    updateMonitor,
    removeMonitor,
    runNow: useCallback(
      (id: string) => {
        const monitor = monitorsRef.current.find((m) => m.id === id);
        if (monitor) return runMonitor(monitor);
        return Promise.resolve(null);
      },
      [runMonitor],
    ),
    generateFromCollections,
    generateFromScannedProjects,
  };
}

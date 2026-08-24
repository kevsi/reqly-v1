"use client";

/**
 * Types + persistance des Monitors (exécutions planifiées locales).
 * MVP « local-first » : le scheduler vit dans l'app ouverte ; le cloud Reqly
 * et les canaux email/Slack dédiés restent en phase 2 (webhook générique OK).
 */
import type { RequestItem } from "@/lib/types";

export const MONITOR_INTERVALS = [300, 900, 1800, 3600, 86400] as const;
export type MonitorInterval = (typeof MONITOR_INTERVALS)[number];

/** Snapshot autonome de la requête surveillée (survit à la suppression de la collection). */
export interface MonitorHttpRequest {
  id: string;
  name: string;
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface MonitorHeaderCheck {
  /** Nom du header (comparaison insensible à la casse). */
  name: string;
  /** Si défini, la valeur du header doit contenir cette sous-chaîne. */
  contains?: string;
}

export interface MonitorChecks {
  /** Code HTTP attendu (défaut 200). */
  expectedStatus: number;
  /** Au-delà, l'exécution passe en « dégradé » même si les assertions passent. */
  latencyThresholdMs?: number;
  /** Headers de réponse requis (existants, et contenant `contains` si défini). */
  headers?: MonitorHeaderCheck[];
  /** Sous-chaîne devant apparaître dans le corps de réponse. */
  bodyContains?: string;
  /** JSON-path devant résoudre vers une valeur non nulle. */
  bodyJsonPath?: string;
}

export interface Monitor {
  id: string;
  name: string;
  enabled: boolean;
  intervalSec: MonitorInterval;
  checks: MonitorChecks;
  /** Webhook générique : POST JSON sur chaque transition fail/degraded/recovered. */
  webhookUrl?: string;
  requests: MonitorHttpRequest[];
  createdAt: number;
  updatedAt: number;
}

export type MonitorRunStatus = "pass" | "fail" | "degraded";

export interface MonitorRunCheck {
  requestId: string;
  name: string;
  ok: boolean;
  statusCode?: number;
  durationMs?: number;
  degraded?: boolean;
  error?: string;
}

export interface MonitorRunRecord {
  id: string;
  monitorId: string;
  at: number;
  status: MonitorRunStatus;
  durationMs: number;
  checks: MonitorRunCheck[];
  /** Nombre de retries effectués avant conclusion (0 = premier essai concluant). */
  retries?: number;
}

const MONITORS_KEY = "reqly-monitors-v1";
const HISTORY_KEY = "reqly-monitor-history-v1";
const MAX_HISTORY = 300;

function sanitizeChecks(value: unknown): MonitorChecks {
  const raw = (value ?? {}) as Partial<MonitorChecks>;
  const expectedStatus =
    typeof raw.expectedStatus === "number" && Number.isFinite(raw.expectedStatus)
      ? raw.expectedStatus
      : 200;
  const latencyThresholdMs =
    typeof raw.latencyThresholdMs === "number" && raw.latencyThresholdMs > 0
      ? raw.latencyThresholdMs
      : undefined;
  const headers = Array.isArray(raw.headers)
    ? raw.headers
        .filter(
          (h): h is MonitorHeaderCheck =>
            !!h && typeof h === "object" && typeof h.name === "string" && h.name.length > 0,
        )
        .slice(0, 10)
    : undefined;
  const bodyContains =
    typeof raw.bodyContains === "string" && raw.bodyContains.length > 0
      ? raw.bodyContains.slice(0, 500)
      : undefined;
  const bodyJsonPath =
    typeof raw.bodyJsonPath === "string" && raw.bodyJsonPath.length > 0
      ? raw.bodyJsonPath.slice(0, 300)
      : undefined;
  return {
    expectedStatus,
    ...(latencyThresholdMs ? { latencyThresholdMs } : {}),
    ...(headers && headers.length > 0 ? { headers } : {}),
    ...(bodyContains ? { bodyContains } : {}),
    ...(bodyJsonPath ? { bodyJsonPath } : {}),
  };
}

function isMonitor(value: unknown): value is Monitor {
  if (!value || typeof value !== "object") return false;
  const m = value as Partial<Monitor>;
  if (
    typeof m.id !== "string" ||
    typeof m.name !== "string" ||
    typeof m.enabled !== "boolean" ||
    !Array.isArray(m.requests)
  ) {
    return false;
  }
  // Rejeter les requêtes malformées plutôt que le monitor entier.
  m.requests = m.requests.filter(
    (r): r is MonitorHttpRequest =>
      !!r &&
      typeof r === "object" &&
      typeof (r as MonitorHttpRequest).id === "string" &&
      typeof (r as MonitorHttpRequest).url === "string",
  );
  return (
    MONITOR_INTERVALS.includes(m.intervalSec as MonitorInterval) ||
    // Tolérer un intervalle numérique arbitraire positif issu d'une version antérieure.
    (typeof m.intervalSec === "number" && m.intervalSec > 0)
  );
}

/** Normalise un monitor lu depuis le storage (valeurs par défaut sûres). */
function normalizeMonitor(raw: Monitor): Monitor {
  return {
    ...raw,
    intervalSec: MONITOR_INTERVALS.includes(raw.intervalSec as MonitorInterval)
      ? (raw.intervalSec as MonitorInterval)
      : (MONITOR_INTERVALS.find((i) => i >= raw.intervalSec) ?? 1800),
    checks: sanitizeChecks(raw.checks),
    webhookUrl:
      typeof raw.webhookUrl === "string" && raw.webhookUrl.trim().length > 0
        ? raw.webhookUrl.trim()
        : undefined,
    requests: raw.requests.map((r) => ({
      id: r.id,
      name: typeof r.name === "string" ? r.name : r.id,
      method: typeof r.method === "string" ? r.method.toUpperCase() : "GET",
      url: r.url,
      headers:
        r.headers && typeof r.headers === "object"
          ? (Object.fromEntries(
              Object.entries(r.headers)
                .filter(([, v]) => v != null)
                .map(([k, v]) => [String(k), String(v)]),
            ) as Record<string, string>)
          : undefined,
      body: typeof r.body === "string" ? r.body : undefined,
    })),
  };
}

export function loadMonitors(): Monitor[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(MONITORS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isMonitor).map(normalizeMonitor);
  } catch {
    return [];
  }
}

export function saveMonitors(monitors: Monitor[]): void {
  try {
    window.localStorage.setItem(MONITORS_KEY, JSON.stringify(monitors));
  } catch {
    /* quota / private mode */
  }
}

export function loadHistory(): MonitorRunRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is MonitorRunRecord =>
        !!r && typeof r === "object" && typeof (r as MonitorRunRecord).monitorId === "string",
    );
  } catch {
    return [];
  }
}

export function saveHistory(history: MonitorRunRecord[]): void {
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
  } catch {
    /* quota / private mode */
  }
}

/** Convertit une requête du store en snapshot de monitor. */
export function requestToMonitorRequest(item: RequestItem): MonitorHttpRequest {
  return {
    id: item.id,
    name: item.name,
    method: String(item.method),
    url: item.url || item.endpoint,
    headers: item.headers,
    body: item.body,
  };
}

/**
 * Logique monitors partagée client/serveur (aucune dépendance React ni DOM) :
 * construction des assertions natives, évaluation d'un rapport, payload webhook.
 */
import type { Monitor } from "./types";

export interface MonitorCheckResultLike {
  requestId: string;
  name: string;
  /** Statut du moteur de test quand on passe par lui (client). Absent côté cron. */
  runnerStatus?: "pass" | "fail" | "skipped" | "errored";
  statusCode?: number;
  responseTimeMs?: number;
  responseBodyPreview?: string;
  responseHeaders?: Record<string, string>;
  error?: string;
}

/** Assertions natives passées au moteur pour chaque requête monitorée. */
export function buildNativeAssertions(monitor: Monitor): Array<Record<string, unknown>> {
  const assertions: Array<Record<string, unknown>> = [];
  if (monitor.checks.expectedStatus > 0) {
    assertions.push({ type: "status", expected: monitor.checks.expectedStatus });
  }
  for (const header of monitor.checks.headers ?? []) {
    assertions.push({
      type: "header",
      name: header.name,
      operator: header.contains ? "contains" : "exists",
      ...(header.contains ? { value: header.contains } : {}),
    });
  }
  return assertions;
}

/** Checks hors assertions : headers requis + bodyContains + jsonPath. */
function evaluateExtraChecks(
  result: MonitorCheckResultLike,
  checks: Monitor["checks"],
): { ok: boolean; error?: string } {
  const lowerHeaders = result.responseHeaders ?? {};
  for (const header of checks.headers ?? []) {
    const value = lowerHeaders[header.name.toLowerCase()];
    if (value == null) {
      return { ok: false, error: `Header « ${header.name} » absent` };
    }
    if (header.contains && !value.includes(header.contains)) {
      return {
        ok: false,
        error: `Header « ${header.name} » sans « ${header.contains.slice(0, 80)} »`,
      };
    }
  }
  const body = result.responseBodyPreview ?? "";
  if (checks.bodyContains && !body.includes(checks.bodyContains)) {
    return { ok: false, error: `Corps sans « ${checks.bodyContains.slice(0, 80)} »` };
  }
  if (checks.bodyJsonPath) {
    try {
      const parsed: unknown = JSON.parse(body);
      // Résolution dot-path minimale ("data.items.0.id"), suffisante en monitor.
      let current: unknown = parsed;
      for (const key of checks.bodyJsonPath.replace(/^\$\.?/, "").split(".")) {
        if (current == null || typeof current !== "object") {
          current = undefined;
          break;
        }
        current = (current as Record<string, unknown>)[key];
      }
      if (current === undefined || current === null) {
        return { ok: false, error: `jsonPath « ${checks.bodyJsonPath} » introuvable` };
      }
    } catch {
      return { ok: false, error: "Corps non JSON pour jsonPath" };
    }
  }
  return { ok: true };
}

export function evaluateMonitorResults(
  results: MonitorCheckResultLike[],
  checks: Monitor["checks"],
): {
  status: "pass" | "fail" | "degraded";
  checksOut: Array<{
    requestId: string;
    name: string;
    ok: boolean;
    statusCode?: number;
    durationMs?: number;
    degraded?: boolean;
    error?: string;
  }>;
} {
  const expected = checks.expectedStatus;
  const checksOut = results.map((r) => {
    const statusMatches =
      r.statusCode !== undefined && r.statusCode >= 200 && r.statusCode < 400
        ? expected > 0
          ? r.statusCode === expected
          : true
        : false;
    const extra = evaluateExtraChecks(r, checks);
    // runnerStatus "fail" couvre les assertions natives (statut/headers) quand
    // le moteur de test est utilisé ; côté cron il est absent.
    const runnerOk = r.runnerStatus !== "fail" && r.runnerStatus !== "errored";
    const ok = r.error === undefined && runnerOk && statusMatches && extra.ok;
    return {
      requestId: r.requestId,
      name: r.name,
      ok,
      statusCode: r.statusCode,
      durationMs: r.responseTimeMs,
      degraded: !!checks.latencyThresholdMs && ok && (r.responseTimeMs ?? 0) > checks.latencyThresholdMs,
      error:
        r.error ??
        (!statusMatches && r.statusCode !== undefined
          ? `Statut ${r.statusCode} ≠ attendu ${expected}`
          : undefined) ??
        extra.error,
    };
  });
  const hasFailure = checksOut.some((c) => !c.ok);
  const hasDegraded = checksOut.some((c) => c.degraded);
  return {
    status: hasFailure ? "fail" : hasDegraded ? "degraded" : "pass",
    checksOut,
  };
}

export interface MonitorAlertPayload {
  event: "failure" | "degraded" | "recovered";
  monitor: { id: string; name: string };
  at: number;
  durationMs: number;
  summary: {
    total: number;
    passed: number;
    failed: number;
    worstLatencyMs?: number;
  };
  failures: Array<{ name: string; statusCode?: number; error?: string }>;
}

/** Événement d'alerte par transition uniquement (anti-bruit spec). */
export function alertEventFor(
  status: MonitorRunStatusLite,
  previous?: MonitorRunStatusLite,
): "failure" | "degraded" | "recovered" | null {
  if (status === "fail" && previous !== "fail") return "failure";
  if (status === "degraded" && previous !== "degraded") return "degraded";
  if (status === "pass" && (previous === "fail" || previous === "degraded")) return "recovered";
  return null;
}

type MonitorRunStatusLite = "pass" | "fail" | "degraded";

type MonitorRunChecksLite = Array<{
  ok: boolean;
  name: string;
  statusCode?: number;
  durationMs?: number;
  error?: string;
}>;

export function buildAlertPayload(
  monitor: Pick<Monitor, "id" | "name">,
  record: { at: number; durationMs: number; status: MonitorRunStatusLite },
  checksOut: MonitorRunChecksLite,
  previous?: MonitorRunStatusLite,
): { event: MonitorAlertPayload["event"]; payload: MonitorAlertPayload } | null {
  const event = alertEventFor(record.status, previous);
  if (!event) return null;
  return {
    event,
    payload: {
      event,
      monitor: { id: monitor.id, name: monitor.name },
      at: record.at,
      durationMs: record.durationMs,
      summary: {
        total: checksOut.length,
        passed: checksOut.filter((c) => c.ok).length,
        failed: checksOut.filter((c) => !c.ok).length,
        worstLatencyMs: Math.max(0, ...checksOut.map((c) => c.durationMs ?? 0)),
      },
      failures: checksOut
        .filter((c) => !c.ok)
        .map((c) => ({
          name: c.name,
          statusCode: c.statusCode,
          error: c.error && c.error.length > 300 ? `${c.error.slice(0, 300)}…` : c.error,
        })),
    },
  };
}

/**
 * Client des Monitors serveur : pousse une définition de monitor (snapshot
 * autonome des requêtes + checks) vers le sync-server qui l'exécute à
 * intervalle régulier même quand l'app est fermée.
 *
 * L'API est l'API session classique du sync-server (cookie auth_session ou
 * Bearer token). Nécessite NEXT_PUBLIC_SYNC_URL + une session active.
 */
import { getPublicEnv } from "@/lib/env";
import type { Monitor } from "@/lib/monitors/types";

export interface ServerMonitorInfo {
  id: string;
  name: string;
  enabled: boolean;
  intervalSec: number;
  lastStatus: string | null;
  nextRunAt: number;
}

export interface ServerMonitorRun {
  id: number;
  status: "pass" | "fail" | "degraded";
  durationMs: number;
  checks: Array<{
    requestId: string;
    name: string;
    ok: boolean;
    statusCode?: number;
    durationMs?: number;
    degraded?: boolean;
    error?: string;
  }>;
  at: number;
}

export function getMonitorSyncBaseUrl(): string {
  try {
    return (getPublicEnv().NEXT_PUBLIC_SYNC_URL || "").replace(/\/$/, "");
  } catch {
    return "";
  }
}

/** La synchronisation serveur n'est disponible qu'avec un sync-server configuré. */
export function isServerMonitorSyncAvailable(): boolean {
  return getMonitorSyncBaseUrl() !== "";
}

async function monitorRequest(
  path: string,
  init: RequestInit & { token?: string | null },
): Promise<Response> {
  const baseUrl = getMonitorSyncBaseUrl();
  if (!baseUrl) throw new Error("Sync server non configuré");
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
  };
  if (init.body) headers["Content-Type"] = "application/json";
  return fetch(`${baseUrl}/api/monitors${path}`, { ...init, headers });
}

/** Pousse (crée ou met à jour) la définition serveur du monitor. */
export async function pushMonitorToServer(
  monitor: Monitor,
  token: string | null,
): Promise<ServerMonitorInfo> {
  const body = JSON.stringify({
    name: monitor.name,
    enabled: monitor.enabled,
    intervalSec: monitor.intervalSec,
    checks: monitor.checks,
    webhookUrl: monitor.webhookUrl,
    requests: monitor.requests,
  });

  if (monitor.serverId) {
    const res = await monitorRequest(`/${encodeURIComponent(monitor.serverId)}`, {
      method: "PATCH",
      body,
      token,
    });
    if (res.status === 404) {
      // Définition disparue côté serveur : repartir d'une création.
      const created = await monitorRequest("/", { method: "POST", body, token });
      if (!created.ok) throw new Error(await describeError(created));
      const data = (await created.json()) as { monitor: ServerMonitorInfo };
      return { ...data.monitor };
    }
    if (!res.ok) throw new Error(await describeError(res));
    const data = (await res.json()) as { monitor: ServerMonitorInfo };
    return { ...data.monitor, id: monitor.serverId ?? data.monitor.id };
  }

  const created = await monitorRequest("/", { method: "POST", body, token });
  if (!created.ok) throw new Error(await describeError(created));
  const data = (await created.json()) as { monitor: ServerMonitorInfo };
  return data.monitor;
}

export async function deleteMonitorFromServer(
  serverId: string,
  token: string | null,
): Promise<void> {
  const res = await monitorRequest(`/${encodeURIComponent(serverId)}`, {
    method: "DELETE",
    token,
  });
  // 404 = déjà parti : c'est l'objectif, pas une erreur.
  if (!res.ok && res.status !== 404) throw new Error(await describeError(res));
}

export async function fetchServerRuns(
  serverId: string,
  token: string | null,
): Promise<ServerMonitorRun[]> {
  const res = await monitorRequest(`/${encodeURIComponent(serverId)}/runs`, {
    method: "GET",
    token,
  });
  if (!res.ok) throw new Error(await describeError(res));
  const data = (await res.json()) as { runs: ServerMonitorRun[] };
  return data.runs;
}

async function describeError(res: Response): Promise<string> {
  const payload = (await res.json().catch(() => null)) as { error?: string } | null;
  return payload?.error || `Erreur monitor serveur (${res.status})`;
}

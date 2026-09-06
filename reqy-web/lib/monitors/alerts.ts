"use client";

/**
 * Alertes webhook des monitors : POST JSON fire-and-forget avec timeout court.
 * Un échec de livraison n'affecte jamais le résultat du monitor lui-même.
 * Compatible client (browser) et serveur (route cron) : setTimeout global.
 */
import { buildAlertPayload, type MonitorAlertPayload } from "./shared";
import type { Monitor } from "./types";

const WEBHOOK_TIMEOUT_MS = 5000;

export type { MonitorAlertPayload };

/** Construit le payload si transition d'état, sinon null. Wrapper sur shared.ts. */
export function maybeAlertPayload(
  monitor: Pick<Monitor, "id" | "name">,
  record: { at: number; durationMs: number; status: "pass" | "fail" | "degraded" },
  checksOut: Array<{ ok: boolean; name: string; statusCode?: number; durationMs?: number; error?: string }>,
  previous?: "pass" | "fail" | "degraded",
): { event: MonitorAlertPayload["event"]; payload: MonitorAlertPayload } | null {
  return buildAlertPayload(monitor, record, checksOut, previous);
}

export async function sendMonitorWebhook(
  url: string,
  payload: MonitorAlertPayload,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  // Ne jamais exfiltrer de gros extraits vers un service externe.
  const safe: MonitorAlertPayload = {
    ...payload,
    failures: payload.failures.map((f) => ({
      ...f,
      error:
        f.error && f.error.length > 300 ? `${f.error.slice(0, 300)}…` : f.error,
    })),
  };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(safe),
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// La variante serveur (pinning SSRF) vit dans alerts-server.ts — hors du
// bundle client, sinon webpack échoue sur node:crypto au build desktop.

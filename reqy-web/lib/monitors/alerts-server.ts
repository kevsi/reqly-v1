/**
 * Variante SERVEUR de l'envoi webhook monitor (route cron uniquement).
 *
 * Séparée de alerts.ts (marqué "use client") : le pinning SSRF
 * (pinned-dispatcher → node:crypto/undici) ne doit JAMAIS entrer dans le
 * bundle client — même en import dynamique, webpack le bundlerait et le
 * build desktop échoue sur `node:crypto`. Le navigateur, lui, poste son
 * webhook directement (sendMonitorWebhook dans alerts.ts).
 */
import type { MonitorAlertPayload } from "./shared";
import { createPinnedDispatcher } from "@/lib/security/pinned-dispatcher";

const WEBHOOK_TIMEOUT_MS = 5000;

export async function sendMonitorWebhookServer(
  url: string,
  payload: MonitorAlertPayload,
): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;

  let pinned;
  try {
    pinned = await createPinnedDispatcher(url);
  } catch {
    return false; // hôte privé/bloqué — livraison refusée
  }

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
      redirect: "manual",
      signal: controller.signal,
      ...(pinned ? { dispatcher: pinned } : {}),
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    pinned?.close().catch(() => undefined);
  }
}

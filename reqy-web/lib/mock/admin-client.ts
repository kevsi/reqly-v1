"use client";

/**
 * Client du canal d'administration d'un mock en cours (`/mock/__admin/*`).
 * L'UI s'y attache pour : état, logs temps réel, reset, push de config à chaud.
 */

export interface MockAdminSettings {
  /** ex. http://127.0.0.1:4015 */
  base: string;
  token: string;
}

const SETTINGS_KEY = "reqly-mock-admin-settings";

export function loadMockAdminSettings(): MockAdminSettings | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MockAdminSettings>;
    if (!parsed.base || !parsed.token) return null;
    return { base: parsed.base.replace(/\/$/, ""), token: parsed.token };
  } catch {
    return null;
  }
}

export function saveMockAdminSettings(settings: MockAdminSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function clearMockAdminSettings(): void {
  localStorage.removeItem(SETTINGS_KEY);
}

function headers(token: string): Record<string, string> {
  return { "x-admin-token": token };
}

/** Détail de l'échec de connexion — permet un message UI précis. */
export type AliveCheckFailure =
  | { ok: false; reason: "network"; hint: string }
  | { ok: false; reason: "status"; status: number; hint: string }
  | { ok: false; reason: "origin"; hint: string };

export type AliveCheck =
  | { ok: true; data: { name: string | null; routesCount: number; recordings: number } }
  | AliveCheckFailure;

/**
 * Détecte un mock vivant et explique PRÉCISÉMENT l'échec sinon :
 * - network   → rien n'écoute à cette URL (serveur lancé ? bon port ?)
 * - status    → le mock répond mais refuse : 401 token, 501 vieux build…
 * - origin    → 403 : l'origine de l'app n'est pas dans l'allowlist
 */
export async function checkMockAlive(
  settings: MockAdminSettings,
  timeoutMs = 1500,
): Promise<AliveCheck> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${settings.base}/mock/__admin/state`, {
      headers: headers(settings.token),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      if (res.status === 403) {
        return {
          ok: false,
          reason: "origin",
          hint: "Origine refusée par le mock — ouvre l'app via http://localhost:<port> (ou 127.0.0.1).",
        };
      }
      const hints: Record<number, string> = {
        401: "Token admin invalide — recopie-le depuis le terminal du mock.",
        404: "Canal admin inexistant sur cette route.",
        501: "Le serveur mock tourne avec une VIEILLE version du CLI — Ctrl+C puis relance `recli mock start … --admin-token`.",
      };
      return { ok: false, reason: "status", status: res.status, hint: hints[res.status] ?? `HTTP ${res.status}` };
    }
    const body = (await res.json()) as { name: string | null; routesCount: number; recordings: number };
    return { ok: true, data: body };
  } catch {
    return {
      ok: false,
      reason: "network",
      hint: "Injoignable — le serveur tourne-t-il ? (`node recli/dist/index.js mock start <config> --admin-token`)",
    };
  } finally {
    clearTimeout(t);
  }
}

export interface MockLogEntry {
  id: string;
  at: number;
  method: string;
  url: string;
  matchedRouteId: string | null;
  responseStatus: number | null;
  durationMs: number;
  requestBodyPreview?: string;
  responseBodyPreview?: string;
  note?: string;
}

export async function fetchMockLogs(settings: MockAdminSettings): Promise<MockLogEntry[] | null> {
  try {
    const res = await fetch(`${settings.base}/mock/__admin/logs`, {
      headers: headers(settings.token),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { requests: MockLogEntry[] };
    return body.requests;
  } catch {
    return null;
  }
}

export async function resetMockState(settings: MockAdminSettings): Promise<boolean> {
  try {
    const res = await fetch(`${settings.base}/mock/__admin/reset`, {
      method: "POST",
      headers: headers(settings.token),
    });
    return res.status === 204;
  } catch {
    return false;
  }
}

export interface PushConfigResult {
  ok: boolean;
  status: number;
  message?: string;
}

/** Applique une config à chaud sur le mock en cours. */
export async function pushMockConfig(
  settings: MockAdminSettings,
  config: unknown,
): Promise<PushConfigResult> {
  try {
    const res = await fetch(`${settings.base}/mock/__admin/config`, {
      method: "PUT",
      headers: { ...headers(settings.token), "content-type": "application/json" },
      body: JSON.stringify(config),
    });
    if (res.ok) return { ok: true, status: res.status };
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    const messages: Record<string, string> = {
      invalid_mock_config: "Config invalide (version ou routes manquantes)",
      admin_origin_not_allowed: "Origine non autorisée par le mock",
      invalid_admin_token: "Token invalide",
    };
    return {
      ok: false,
      status: res.status,
      message: body.error ? (messages[body.error] ?? body.error) : `HTTP ${res.status}`,
    };
  } catch (err) {
    return { ok: false, status: 0, message: err instanceof Error ? err.message : String(err) };
  }
}

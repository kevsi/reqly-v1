import type { ResponseTimings } from "@/lib/types";

/** A single cookie returned from a Set-Cookie response header. */
export interface TauriCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string;
  expires: string | null;
}

/** Post-processed response returned to callers. */
export interface TauriFetchResponse {
  status: number;
  body: string;
  headers: Record<string, string>;
  durationMs: number;
  encoding: string;
  cookies: TauriCookie[];
  timings: ResponseTimings;
}

export interface TauriErrorPayload {
  kind: string;
  code: string;
  message: string;
  detail: string;
}

export class TauriInvokeError extends Error implements TauriErrorPayload {
  readonly kind: string;
  readonly code: string;
  readonly detail: string;

  constructor(payload: TauriErrorPayload) {
    super(payload.message);
    this.name = "TauriInvokeError";
    this.kind = payload.kind;
    this.code = payload.code;
    this.detail = payload.detail;
  }
}

export function isTauriInvokeError(error: unknown): error is TauriInvokeError {
  return error instanceof TauriInvokeError;
}

function parseTauriErrorPayload(raw: unknown): TauriErrorPayload {
  let candidate: unknown = raw;
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return { kind: "network", code: "unknown", message: String(raw), detail: String(raw) };
    }
  }
  if (candidate && typeof candidate === "object" && "error" in candidate) {
    const nested = (candidate as { error?: unknown }).error;
    if (nested !== undefined) return parseTauriErrorPayload(nested);
  }
  if (candidate && typeof candidate === "object") {
    const value = candidate as Partial<TauriErrorPayload>;
    if (
      typeof value.kind === "string" &&
      typeof value.code === "string" &&
      typeof value.message === "string"
    ) {
      return {
        kind: value.kind,
        code: value.code,
        message: value.message,
        detail: typeof value.detail === "string" ? value.detail : value.message,
      };
    }
  }
  const message = raw instanceof Error ? raw.message : String(raw ?? "Unknown Tauri error");
  return { kind: "network", code: "unknown", message, detail: message };
}

/**
 * Raw response shape from the Tauri IPC bridge.
 *
 * The Rust `TauriFetchResponse` struct uses `Vec<(String, String)>` for
 * headers, which serde serialises as an array of two-element arrays.
 * The conversion to `Record<string, string>` happens in `invokeTauriFetch`.
 */
interface RawTauriFetchResponse {
  status: number;
  body: string;
  headers: Array<[string, string]>;
  durationMs: number;
  encoding: string;
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    secure: boolean;
    httpOnly: boolean;
    sameSite: string;
    expires: string | null;
  }>;
  timings: ResponseTimings;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
  }
}

export const isTauriAvailable = (): boolean => {
  if (typeof window === "undefined") return false;
  // Tauri v2 injecte __TAURI_INTERNALS__ (pas __TAURI__ par défaut)
  // On vérifie les deux pour être compatibles v1 et v2
  return !!window.__TAURI_INTERNALS__ || !!window.__TAURI__;
};

/**
 * Native desktop fetch uses the Tauri backend and intentionally does not
 * enforce the web proxy SSRF guard. This is because the desktop app is a
 * user-controlled API client that must be able to reach local/private APIs.
 *
 * Public or shared deployments should use the web proxy route instead, which
 * includes explicit SSRF protections for outbound HTTP requests.
 */
export async function invokeTauriFetch(
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: string,
  acceptInvalidCerts?: boolean,
  followRedirects?: boolean,
): Promise<TauriFetchResponse> {
  if (!isTauriAvailable()) {
    throw new Error("Tauri is not available in this environment");
  }

  const { invoke } = await import("@tauri-apps/api/core");
  const invokeArgs: Record<string, unknown> = {
    method,
    url,
    headers: Object.entries(headers),
    body,
  };
  if (acceptInvalidCerts === true) invokeArgs.acceptInvalidCerts = true;
  // false seulement : absent/true conserve le comportement historique (suivre).
  if (followRedirects === false) invokeArgs.followRedirects = false;

  let result: RawTauriFetchResponse;
  try {
    result = await invoke<RawTauriFetchResponse>("fetch_proxy", invokeArgs);
  } catch (error) {
    throw new TauriInvokeError(parseTauriErrorPayload(error));
  }

  return {
    status: result.status,
    body: result.body,
    headers: Object.fromEntries(result.headers ?? []),
    durationMs: result.durationMs,
    encoding: result.encoding ?? "utf8",
    cookies: (result.cookies ?? []).map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite,
      expires: c.expires ?? null,
    })),
    timings: result.timings,
  };
}

/**
 * Mirrors `src-tauri/src/capture.rs` `CapturedRequest` (serde camelCase).
 * `responseHeaders` / `responseBody` / `status` are populated after forwarding.
 */
export interface CapturedRequest {
  id: string;
  method: string;
  url: string;
  headers: Array<[string, string]>;
  body: string | null;
  timestamp: number;
  status: number | null;
  responseHeaders: Array<[string, string]> | null;
  responseBody: string | null;
  durationMs: number | null;
  error: string | null;
}

/** Lightweight view returned by `list_captured_sessions`. */
export interface CapturedSummary {
  id: string;
  method: string;
  url: string;
  timestamp: number;
  /** Statut HTTP de la réponse (« null » si pas encore de réponse). */
  status?: number | null;
}

// ---------------------------------------------------------------------------
// Internal helper — converts a CapturedSession returned by the REST API into
// the CapturedRequest shape used throughout the UI (mirrors the Tauri IPC
// shape so both paths produce identical objects).
// ---------------------------------------------------------------------------
interface WebCapturedSession {
  id: string;
  request: {
    id: string;
    timestamp: number;
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: string;
  };
  response: {
    statusCode: number;
    headers: Record<string, string>;
    body: string;
  };
  duration: number;
  size: number;
}

function webSessionToRequest(s: WebCapturedSession): CapturedRequest {
  return {
    id: s.id,
    method: s.request.method,
    url: s.request.url,
    headers: Object.entries(s.request.headers ?? {}),
    body: s.request.body ?? null,
    timestamp: s.request.timestamp,
    status: s.response?.statusCode ?? null,
    responseHeaders: Object.entries(s.response?.headers ?? {}),
    responseBody: s.response?.body ?? null,
    durationMs: s.duration ?? null,
    error: null,
  };
}

/** Helper to safely extract a human-readable string from any error object/payload. */
export function formatErrorMessage(err: unknown): string {
  if (!err) return "Unknown error";
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === "string") return err;
  if (typeof err === "object") {
    const obj = err as Record<string, unknown>;
    if (typeof obj.error === "string") return obj.error;
    if (typeof obj.message === "string") return obj.message;
    if (typeof obj.detail === "string") return obj.detail;
    if (obj.error) return formatErrorMessage(obj.error);
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

/**
 * Traduit les erreurs techniques de l'API capture en messages français
 * actionnables. Le statut HTTP est conservé en fin de message pour le
 * diagnostic.
 */
function friendlyCaptureError(status: number, context: string): Error {
  const detail = ` (${context}, code ${status})`;
  switch (status) {
    case 401:
      return new Error(
        "Authentification requise : connectez-vous pour utiliser la capture de trafic." + detail,
      );
    case 503:
      return new Error(
        "Le service d'authentification est indisponible. Réessayez dans quelques instants." +
          detail,
      );
    case 429:
      return new Error(
        "Trop de requêtes de capture : patientez une minute avant de réessayer." + detail,
      );
    case 404:
      return new Error("Session de capture introuvable. Elle a peut-être été supprimée." + detail);
    default:
      return new Error(
        "Impossible de contacter le service de capture. Vérifiez votre connexion et réessayez." +
          detail,
      );
  }
}

/** Lists the requests retained from the current/last capture session. */
export async function listCapturedSessions(): Promise<CapturedSummary[]> {
  if (isTauriAvailable()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<CapturedSummary[]>("list_captured_sessions");
  }
  // Web fallback: call REST API
  const res = await fetch("/api/capture/sessions?limit=500");
  if (!res.ok) throw friendlyCaptureError(res.status, "liste des sessions");
  const data = (await res.json()) as { sessions?: WebCapturedSession[] };
  const sessions: WebCapturedSession[] = data.sessions ?? (Array.isArray(data) ? data : []);
  return sessions.map((s) => ({
    id: s.id,
    method: s.request.method,
    url: s.request.url,
    timestamp: s.request.timestamp,
    status: s.response?.statusCode ?? null,
  }));
}

/** Returns the full request + response for a single captured session id. */
export async function getCapturedSession(id: string): Promise<CapturedRequest | null> {
  if (isTauriAvailable()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<CapturedRequest | null>("get_captured_session", { id });
  }
  // Web fallback: call REST API
  const res = await fetch(`/api/capture/sessions/${id}`);
  if (res.status === 404) return null;
  if (!res.ok) throw friendlyCaptureError(res.status, "détail de la session");
  const session = (await res.json()) as WebCapturedSession;
  return webSessionToRequest(session);
}

/** Starts the capture proxy.
 *  - Desktop (Tauri): starts a local TCP proxy on the given port.
 *  - Web: activates the server-side capture middleware via REST.
 */
export async function startCaptureProxy(port: number): Promise<void> {
  if (isTauriAvailable()) {
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      await invoke("start_capture_proxy", { port });
    } catch (e) {
      throw new Error(formatErrorMessage(e), { cause: e });
    }
    return;
  }
  // Web fallback: call REST API (port is informational only in web mode)
  const res = await fetch("/api/capture/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bandwidthLimitMbps: 50 }),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    const msg = formatErrorMessage(errData);
    if (msg && !msg.includes("code ")) throw new Error(msg);
    throw friendlyCaptureError(res.status, "démarrage de la capture");
  }
}

/**
 * Retourne l'état courant de la capture côté serveur (web).
 * Utilisé pour resynchroniser l'UI quand l'état a changé dans un autre onglet
 * ou après un rechargement de la page.
 */
export async function getCaptureProxyStatus(): Promise<{
  running: boolean;
  droppedCount?: number;
} | null> {
  if (isTauriAvailable()) return null; // desktop : état local via les événements
  const res = await fetch("/api/capture/status");
  if (!res.ok) {
    if (res.status === 401 || res.status === 503) return null;
    throw friendlyCaptureError(res.status, "état de la capture");
  }
  const data = (await res.json()) as {
    isRunning?: boolean;
    running?: boolean;
    droppedCount?: number;
  };
  return {
    running: Boolean(data.isRunning ?? data.running),
    droppedCount: data.droppedCount ?? 0,
  };
}

// ── Capture HTTPS (MITM) — desktop uniquement ──────────────────────────────

export interface CaptureCaInfo {
  path: string;
  exists: boolean;
}

/** Infos sur la CA de capture : chemin du certificat à installer + présence. */
export async function getCaptureCaInfo(): Promise<CaptureCaInfo | null> {
  if (!isTauriAvailable()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return await invoke<CaptureCaInfo>("get_capture_ca_info");
  } catch (e) {
    throw new Error(formatErrorMessage(e), { cause: e });
  }
}

/** Démarre le listener d'interception HTTPS (tunnels CONNECT). */
export async function startCaptureHttpsProxy(port: number): Promise<string> {
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return await invoke<string>("start_capture_https_proxy", { port });
  } catch (e) {
    throw new Error(formatErrorMessage(e), { cause: e });
  }
}

/** Arrête le listener d'interception HTTPS. */
export async function stopCaptureHttpsProxy(): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    await invoke("stop_capture_https_proxy");
  } catch (e) {
    throw new Error(formatErrorMessage(e), { cause: e });
  }
}

/** Stops the capture proxy. */
export async function stopCaptureProxy(): Promise<void> {  if (isTauriAvailable()) {
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      await invoke("stop_capture_proxy");
    } catch (e) {
      throw new Error(formatErrorMessage(e), { cause: e });
    }
    return;
  }
  // Web fallback
  const res = await fetch("/api/capture/stop", { method: "POST" });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    const msg = formatErrorMessage(errData);
    if (msg && !msg.includes("code ")) throw new Error(msg);
    throw friendlyCaptureError(res.status, "arrêt de la capture");
  }
}

/**
 * Supprime une session capturée (desktop : commande native ; web : REST).
 * Retourne `false` si la session n'existe pas / n'appartient pas à l'utilisateur.
 */
export async function deleteCapturedSession(id: string): Promise<boolean> {
  if (isTauriAvailable()) {
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      await invoke("delete_captured_session", { id });
      return true;
    } catch (e) {
      const msg = formatErrorMessage(e);
      if (msg.includes("not found") || msg.includes("introuvable")) return false;
      throw new Error(msg, { cause: e });
    }
  }
  const res = await fetch(`/api/capture/sessions/${id}`, { method: "DELETE" });
  if (res.status === 404) return false;
  if (!res.ok) throw friendlyCaptureError(res.status, "suppression de la session");
  return true;
}

/**
 * Permanently deletes all persisted captures (both in memory and on disk).
 */
export async function clearCapturedSessions(): Promise<void> {
  if (isTauriAvailable()) {
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      await invoke("clear_captured_sessions");
    } catch (e) {
      throw new Error(formatErrorMessage(e), { cause: e });
    }
    return;
  }
  // Web fallback
  const res = await fetch("/api/capture/sessions", { method: "DELETE" });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    const msg = formatErrorMessage(errData);
    if (msg && !msg.includes("code ")) throw new Error(msg);
    throw friendlyCaptureError(res.status, "effacement des sessions");
  }
}

/**
 * Sets an optional bandwidth cap (in ko/s) applied to forwarded response
 * bodies in the capture proxy. Pass `null` to disable throttling.
 *
 * No-op in web/preview context.
 */
export async function setBandwidthLimit(kbps: number | null): Promise<void> {
  if (!isTauriAvailable()) {
    return;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_bandwidth_limit", { kbps });
}

/**
 * Saves a Blob to disk using Tauri's native "Save As" dialog.
 *
 * The browser's `showSaveFilePicker` / `<a download>` don't work inside a
 * Tauri Webview, so we show a native dialog (`plugin-dialog`) and write the
 * bytes via the `save_file` Rust command (which can write anywhere the user
 * picks, without the fs plugin's scope limits).
 *
 * @returns `"saved"` on success, `"cancelled"` if the user dismissed the dialog.
 * @throws  on any write/invocation error.
 */
/**
 * A single request that failed to send (e.g. due to a network outage) and is
 * waiting to be replayed when connectivity returns.
 *
 * Mirrors `src-tauri/src/store.rs` `QueuedRequest` (serde camelCase). The Rust
 * side stores `body` as `Vec<u8>`, so we transmit it as a `number[]` (UTF-8
 * bytes); a `string` body is accepted for convenience and normalised on send.
 */
export interface QueuedRequest {
  id: string;
  method: string;
  url: string;
  headers: Array<[string, string]>;
  body?: number[] | string;
  createdAt: number;
  reason: string;
}

/** Enqueues a request on the persistent offline queue (Task 12b). */
export async function enqueueRequest(req: QueuedRequest): Promise<void> {
  if (!isTauriAvailable()) {
    return;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("enqueue_request", { req });
}

/** Lists the requests still awaiting delivery, in FIFO order. */
export async function listPending(): Promise<QueuedRequest[]> {
  if (!isTauriAvailable()) {
    return [];
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<QueuedRequest[]>("list_pending");
}

/** Peeks the oldest pending request without removing it. */
export async function dequeueReady(): Promise<QueuedRequest | null> {
  if (!isTauriAvailable()) {
    return null;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<QueuedRequest | null>("dequeue_ready");
}

/** Marks a request as sent (removes it from the queue). */
export async function markSent(id: string): Promise<void> {
  if (!isTauriAvailable()) {
    return;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("mark_sent", { id });
}

export async function saveBlobToDisk(filename: string, blob: Blob): Promise<"saved" | "cancelled"> {
  if (!isTauriAvailable()) {
    throw new Error("saveBlobToDisk requires Tauri desktop environment");
  }
  const { save } = await import("@tauri-apps/plugin-dialog");
  const { invoke } = await import("@tauri-apps/api/core");

  const target = await save({
    defaultPath: filename,
    filters: [{ name: "ZIP archive", extensions: ["zip"] }],
  });
  if (!target) return "cancelled";

  const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
  await invoke("save_file", { path: target, contents: bytes });
  return "saved";
}

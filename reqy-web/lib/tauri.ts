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
): Promise<TauriFetchResponse> {
  if (!isTauriAvailable()) {
    throw new Error("Tauri is not available in this environment");
  }

  const { invoke } = await import("@tauri-apps/api/core");
  const invokeArgs: Record<string, any> = {
    method,
    url,
    headers: Object.entries(headers),
    body,
  };
  if (acceptInvalidCerts === true) invokeArgs.acceptInvalidCerts = true;

  const result = await invoke<RawTauriFetchResponse>("fetch_proxy", invokeArgs);

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
}

/** Lists the requests retained from the current/last capture session. */
export async function listCapturedSessions(): Promise<CapturedSummary[]> {
  if (!isTauriAvailable()) {
    return [];
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<CapturedSummary[]>("list_captured_sessions");
}

/** Returns the full request + response for a single captured session id. */
export async function getCapturedSession(id: string): Promise<CapturedRequest | null> {
  if (!isTauriAvailable()) {
    return null;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<CapturedRequest | null>("get_captured_session", { id });
}

/** Starts the local capture proxy on the given port. */
export async function startCaptureProxy(port: number): Promise<void> {
  if (!isTauriAvailable()) {
    return;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("start_capture_proxy", { port });
}

/** Stops the local capture proxy if it is running. */
export async function stopCaptureProxy(): Promise<void> {
  if (!isTauriAvailable()) {
    return;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("stop_capture_proxy");
}

/**
 * Permanently deletes all persisted captures (both in memory and on disk).
 *
 * No-op in web/preview context.
 */
export async function clearCapturedSessions(): Promise<void> {
  if (!isTauriAvailable()) {
    return;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("clear_captured_sessions");
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

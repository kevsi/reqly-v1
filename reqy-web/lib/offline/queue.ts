/**
 * Store-and-forward offline queue (Task 12b: "Rejeu auto à la reconnexion").
 *
 * This module is the TypeScript side of the queue introduced in Task 12a
 * (`src-tauri/src/store.rs`). It is intentionally thin and dependency-light so
 * it can be unit-tested without a real Tauri runtime or network: the actual
 * persistence lives in Rust, and the request re-sender is injected into
 * {@link replayPending} so tests can drive it with a fake.
 *
 * Key invariant: only *genuine network failures* (no HTTP response was ever
 * produced — DNS failure, timeout, connection refused, "no internet") are
 * queued. Application-level errors (4xx/5xx) carry an HTTP status and are
 * never queued, because retrying them on reconnect would just fail again.
 */

import {
  enqueueRequest,
  listPending,
  markSent,
  isTauriAvailable,
  type QueuedRequest,
} from "@/lib/tauri";

export type { QueuedRequest };

/** Classification of a request failure. */
export type ErrorClass = "network" | "application" | "unknown";

/**
 * Phrases that, appearing in an error's message or name, indicate a
 * network-level problem rather than an application response.
 */
const NETWORK_MESSAGE_RE =
  /(fetch failed|failed to fetch|network ?error|networkerror|timed? ?out|timeout|connection refused|econnrefused|econnreset|dns|enotfound|no internet|no network|load failed|request failed|cannot connect|err_name_not_resolved|err_internet_disconnected|failed to connect)/i;

/**
 * Classifies a request failure.
 *
 * - `network`     — no HTTP response was produced (DNS/timeout/connection
 *                   refused/no internet) OR the error explicitly signals a
 *                   network problem (e.g. `TypeError: fetch failed`,
 *                   `AbortError`/timeout).
 * - `application` — an HTTP response with status >= 400 is present (4xx/5xx).
 * - `unknown`     — nothing classifiable (e.g. a non-error status, or a
 *                   completely opaque error object).
 */
export function classifyError(err: unknown): ErrorClass {
  if (err === null || err === undefined) return "unknown";

  const e = err as {
    status?: unknown;
    response?: { status?: unknown };
    name?: unknown;
    message?: unknown;
  };

  // 1) Application error: an HTTP status is present.
  let status: number | undefined;
  if (typeof e.status === "number") status = e.status;
  else if (e.response && typeof e.response.status === "number") status = e.response.status;

  if (typeof status === "number") {
    if (status >= 400) return "application";
    // 1xx–3xx are not failure classes from our perspective.
    return "unknown";
  }

  // 2) Network error signals.
  const name = typeof e.name === "string" ? e.name : "";
  const message = typeof e.message === "string" ? e.message : String(err);

  if (name === "AbortError") return "network"; // request timed out
  if (name === "TypeError" && NETWORK_MESSAGE_RE.test(message)) return "network";
  if (NETWORK_MESSAGE_RE.test(message)) return "network";

  // 3) No HTTP status was produced. The absence of a status is itself a
  //    strong network-failure signal (the request never got a response), so
  //    we default to "network" — the safe choice for store-and-forward: the
  //    worst case is we retry a non-network glitch, which simply fails again.
  return "network";
}

/** A request to be queued for later replay. */
export interface OfflineRequestInput {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

/**
 * Options controlling whether a failure is treated as a network failure.
 * Provide either the original `error` (classified via {@link classifyError}) or
 * a pre-computed `classification`. If neither is given, the call is a no-op.
 */
export interface EnqueueOptions {
  error?: unknown;
  classification?: ErrorClass;
}

function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `q-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Enqueues a request for replay **only** when the failure was a network
 * problem. Application errors (4xx/5xx) and unclassifiable errors are never
 * queued.
 *
 * Safe to call anywhere: it is a no-op when Tauri is unavailable (web/preview)
 * and swallows its own errors so a queue hiccup can never break the request
 * flow that triggered it.
 */
export async function enqueueOnNetworkFailure(
  request: OfflineRequestInput,
  opts: EnqueueOptions = {},
): Promise<void> {
  if (!isTauriAvailable()) return;

  const classification =
    opts.classification ?? (opts.error !== undefined ? classifyError(opts.error) : "unknown");
  if (classification !== "network") return;

  const headers = Object.entries(request.headers ?? {});
  const body =
    request.body !== undefined ? Array.from(new TextEncoder().encode(request.body)) : undefined;

  await enqueueRequest({
    id: generateId(),
    method: request.method,
    url: request.url,
    headers,
    body,
    createdAt: Date.now(),
    reason: "network",
  });
}

/**
 * Options for {@link replayPending}.
 */
export interface ReplayOptions {
  /**
   * Re-sends a single queued request. Returns `{ ok: true }` when the request
   * was *delivered* (network succeeded) regardless of the HTTP status — a 4xx
   * on replay still means the network came back. Return/throw `{ ok: false }`
   * to keep the item in the queue for the next reconnect.
   */
  execute: (req: QueuedRequest) => Promise<{ ok: boolean }>;
  /** Called once per replayed item with the outcome. */
  onReplayed?: (id: string, ok: boolean) => void;
}

/**
 * Replays every queued request through the injected `execute`, marking each
 * one as sent on success.
 *
 * Returns the total number replayed and the number that succeeded. A replay
 * whose `execute` throws or resolves `{ ok: false }` is left in the queue.
 */
export async function replayPending(
  opts: ReplayOptions,
): Promise<{ replayed: number; succeeded: number }> {
  if (!isTauriAvailable()) return { replayed: 0, succeeded: 0 };

  const pending = await listPending();
  let replayed = 0;
  let succeeded = 0;

  for (const req of pending) {
    let ok = false;
    try {
      const res = await opts.execute(req);
      ok = res?.ok === true;
    } catch {
      // keep the default false value
    }

    replayed++;
    if (ok) {
      succeeded++;
      await markSent(req.id);
    }
    opts.onReplayed?.(req.id, ok);
  }

  return { replayed, succeeded };
}

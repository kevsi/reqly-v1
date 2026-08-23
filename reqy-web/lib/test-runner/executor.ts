import type { RequestResponse } from "./types";
import { invokeTauriFetch, isTauriAvailable } from "@/lib/tauri";
import { parseJsonSafe } from "@/lib/utils";
import { proxyAuthHeaders } from "@/lib/proxy-auth";

export interface RunnerExecutorOptions {
  workspaceId?: string | null;
  /** Use direct fetch (server-side API routes � no CORS). */
  serverSide?: boolean;
  /** Abort the active web request when the user stops a run. */
  signal?: AbortSignal;
  /** Progress callback invoked once per settled request (success or failure). */
  onRequestDone?: (completed: number, total: number) => void;
}

function parseResponseBody(body: string, headers: Record<string, string>): unknown {
  const contentType = (headers["content-type"] || headers["Content-Type"] || "").toLowerCase();
  if (
    contentType.includes("json") ||
    body.trimStart().startsWith("{") ||
    body.trimStart().startsWith("[")
  ) {
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }
  return body;
}

async function executeViaProxy(
  req: { method: string; url: string; headers: Record<string, string>; body?: unknown },
  workspaceId: string | null | undefined,
  signal?: AbortSignal,
): Promise<RequestResponse> {
  if (signal?.aborted) throw new Error("Execution annulée");
  const started = Date.now();
  const proxyResponse = await fetch("/api/proxy", {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      ...proxyAuthHeaders(),
      ...(workspaceId ? { "x-workspace-id": workspaceId } : {}),
    },
    body: JSON.stringify({
      url: req.url,
      method: req.method,
      headers: req.headers,
      body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
      workspaceId,
    }),
  });

  const proxyResult = await parseJsonSafe(proxyResponse);
  const responseTimeMs = proxyResult.durationMs ?? Date.now() - started;

  if (!proxyResponse.ok) {
    throw new Error(proxyResult.error || proxyResponse.statusText || "Proxy request failed");
  }

  const responseHeaders = (proxyResult.headers || {}) as Record<string, string>;
  const rawBody =
    typeof proxyResult.body === "string" ? proxyResult.body : String(proxyResult.body ?? "");

  return {
    statusCode: proxyResult.status ?? proxyResponse.status,
    responseTimeMs,
    body: parseResponseBody(rawBody, responseHeaders),
    headers: responseHeaders,
  };
}

async function executeViaTauri(req: {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
}): Promise<RequestResponse> {
  if (req.signal?.aborted) throw new Error("Execution annulée");
  const bodyStr =
    req.body !== undefined && req.body !== null
      ? typeof req.body === "string"
        ? req.body
        : JSON.stringify(req.body)
      : undefined;

  const result = await invokeTauriFetch(req.method, req.url, req.headers, bodyStr);
  if (req.signal?.aborted) throw new Error("Execution annulée");

  return {
    statusCode: result.status,
    responseTimeMs: result.durationMs,
    body: parseResponseBody(result.body, result.headers),
    headers: result.headers,
  };
}

async function executeDirect(req: {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
}): Promise<RequestResponse> {
  if (req.signal?.aborted) throw new Error("Execution annulée");
  const started = Date.now();
  const res = await fetch(req.url, {
    method: req.method,
    headers: req.headers,
    body: req.body as BodyInit | undefined,
    signal: req.signal,
  });
  const text = await res.text();
  const headers = Object.fromEntries(res.headers.entries());
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return {
    statusCode: res.status,
    responseTimeMs: Date.now() - started,
    body: parseResponseBody(text, headers),
    headers,
  };
}

export function createRunnerExecutor(options: RunnerExecutorOptions = {}) {
  return async (req: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: unknown;
  }): Promise<RequestResponse> => {
    if (options.signal?.aborted) throw new Error("Execution annulée");
    if (options.serverSide) {
      return executeDirect({ ...req, signal: options.signal });
    }
    if (isTauriAvailable()) {
      return executeViaTauri({ ...req, signal: options.signal });
    }
    return executeViaProxy(req, options.workspaceId, options.signal);
  };
}

export interface RequestInput {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
}

/**
 * Run a batch of requests with bounded concurrency.
 *
 * Returns one entry per input request, in the same order, even if execution
 * is interleaved. Failures are caught and surfaced as a rejected promise on
 * the per-request entry — one bad request does NOT abort the whole batch.
 *
 * `concurrency` defaults to 4, which is a good balance between throughput
 * and not overwhelming the proxy / target server.
 */
export async function runRequestsConcurrent(
  requests: RequestInput[],
  options: RunnerExecutorOptions & { concurrency?: number } = {},
): Promise<Array<{ ok: true; response: RequestResponse } | { ok: false; error: string }>> {
  const concurrency = Math.max(1, options.concurrency ?? 4);
  const execute = createRunnerExecutor(options);

  const results: Array<{ ok: true; response: RequestResponse } | { ok: false; error: string }> =
    new Array(requests.length);

  let cursor = 0;
  let completed = 0;
  async function worker(): Promise<void> {
    while (true) {
      const idx = cursor++;
      if (idx >= requests.length) return;
      try {
        const response = await execute(requests[idx]);
        results[idx] = { ok: true, response };
      } catch (e) {
        results[idx] = { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
      completed++;
      options.onRequestDone?.(completed, requests.length);
    }
  }

  const workers: Array<Promise<void>> = [];
  const n = Math.min(concurrency, requests.length);
  for (let i = 0; i < n; i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

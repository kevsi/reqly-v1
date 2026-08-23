"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type { KeyValuePair } from "@/components/key-value-editor";

export interface SSEEvent {
  id: string;
  event: string;
  data: string;
  timestamp: number;
}

export type SSEStatus = "idle" | "connecting" | "open" | "closed" | "error";

export type SSEAuthType = "none" | "bearer" | "basic";

export interface SSEAuthConfig {
  type: SSEAuthType;
  token: string;
}

export interface SSEConnectOptions {
  url: string;
  method?: "GET" | "POST" | "PUT";
  body?: string;
  headers?: KeyValuePair[];
  auth?: SSEAuthConfig;
  maxEvents?: number;
  eventFilter?: string;
  /** Automatically retry when the connection drops. Default: true. */
  autoReconnect?: boolean;
  /** Consecutive reconnection attempts per connect() call before giving up. Default: 5. */
  maxReconnects?: number;
}

const DEFAULT_MAX_EVENTS = 500;
const MAX_EVENTS_CAP = 5000;
const DEFAULT_RETRY_MS = 1000;
const MAX_RETRY_MS = 30_000;

function buildFetchHeaders(headers?: KeyValuePair[], auth?: SSEAuthConfig): Record<string, string> {
  const result: Record<string, string> = {};

  if (headers) {
    for (const h of headers) {
      if (h.key && h.enabled !== false) {
        result[h.key] = h.value;
      }
    }
  }

  if (auth && auth.type !== "none" && auth.token) {
    if (auth.type === "bearer") {
      result["Authorization"] = `Bearer ${auth.token}`;
    } else if (auth.type === "basic") {
      result["Authorization"] = `Basic ${auth.token}`;
    }
  }

  return result;
}

interface SSEStreamCallbacks {
  headers?: Record<string, string>;
  method?: "GET" | "POST" | "PUT";
  body?: string;
  onMessage?: (data: string, eventType: string, lastEventId: string) => void;
  onOpen?: () => void;
  onRetry?: (retryMs: number) => void;
  /** retryable=false for HTTP errors that a retry cannot fix (4xx/5xx). */
  onError?: (error: Error, retryable?: boolean) => void;
  signal?: AbortSignal;
}

function parseSSEField(line: string): [string, string] {
  const colonIdx = line.indexOf(":");
  if (colonIdx === -1) return [line, ""];
  let value = line.slice(colonIdx + 1);
  if (value.startsWith(" ")) value = value.slice(1);
  return [line.slice(0, colonIdx), value];
}

/**
 * Fetch-based SSE parser.
 *
 * Handles LF, CRLF and lone-CR line endings, dispatches multi-line `data`
 * fields joined with `\n`, ignores comment lines, honors `id` (dropping
 * values containing U+0000 per the spec) and forwards the server `retry:`
 * hint through `onRetry`. A pending event with no trailing blank line is
 * flushed when the stream ends.
 */
export async function createSSEStream(
  url: string,
  {
    headers = {},
    method = "GET",
    body,
    onMessage,
    onOpen,
    onRetry,
    onError,
    signal,
  }: SSEStreamCallbacks,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url, { method, headers, body, signal });
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") return;
    const message = err instanceof Error ? err.message : String(err);
    onError?.(new Error(`Impossible de se connecter au flux SSE : ${message}`), true);
    return;
  }

  if (!response.ok) {
    onError?.(
      new Error(`Connexion SSE refusée par le serveur (${response.status} ${response.statusText})`),
      false,
    );
    return;
  }

  let reader: ReadableStreamDefaultReader<Uint8Array> | null;
  try {
    reader = response.body?.getReader() ?? null;
  } catch {
    onError?.(new Error("Le flux SSE n'a pas de corps lisible"), true);
    return;
  }
  if (!reader) {
    onError?.(new Error("Le flux SSE n'a pas de corps lisible"), true);
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let lastEventId = "";
  let currentEvent = "";
  let currentData: string[] = [];
  let sawData = false;

  const dispatchPending = () => {
    if (!sawData) return;
    onMessage?.(currentData.join("\n"), currentEvent || "message", lastEventId);
    currentEvent = "";
    currentData = [];
    sawData = false;
  };

  const processLine = (rawLine: string) => {
    let line = rawLine;
    // Strip CR so CRLF and lone-CR line endings behave like LF.
    if (line.endsWith("\r")) line = line.slice(0, -1);

    // Comment lines (starting with colon) are ignored.
    if (line.startsWith(":")) return;

    // Empty line dispatches the event.
    if (line === "") {
      dispatchPending();
      return;
    }

    const [field, fieldValue] = parseSSEField(line);

    switch (field) {
      case "event":
        currentEvent = fieldValue;
        break;
      case "data":
        currentData.push(fieldValue);
        sawData = true;
        break;
      case "id":
        // Per the SSE spec, ids containing U+0000 must be ignored.
        if (fieldValue && !fieldValue.includes("\u0000")) lastEventId = fieldValue;
        break;
      case "retry": {
        const retryMs = parseInt(fieldValue, 10);
        if (Number.isFinite(retryMs) && retryMs > 0) onRetry?.(retryMs);
        break;
      }
    }
  };

  onOpen?.();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const rawLine of lines) {
        processLine(rawLine);
      }
    }

    // Process the final line left in the buffer (the server closed the
    // stream without a trailing newline)…
    if (buffer) {
      processLine(buffer);
    }
    // …then flush an event left pending without a trailing blank line.
    dispatchPending();
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") return;
    const error = err instanceof Error ? err : new Error(String(err));
    onError?.(error, true);
    return;
  }
}

export function useSSE() {
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [status, setStatus] = useState<SSEStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [totalBytes, setTotalBytes] = useState(0);
  const [eventsPerSec, setEventsPerSec] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [reconnectCount, setReconnectCount] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Resume state is scoped per stream: each URL keeps its own last event id
  // so reconnecting to a different stream never leaks the previous one.
  const lastEventIdsRef = useRef(new Map<string, string>());
  const retryDelayRef = useRef(DEFAULT_RETRY_MS);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectsRef = useRef(5);
  const autoReconnectRef = useRef(true);
  const maxEventsRef = useRef(DEFAULT_MAX_EVENTS);
  const eventFilterRef = useRef<string | undefined>(undefined);
  const isPausedRef = useRef(false);
  const lastErrorRef = useRef<string>("La connexion a été interrompue.");

  // Keep a ref in sync with the state so the running stream callbacks never
  // observe a stale `isPaused` value (the stream is created once per connect).
  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearReconnectTimer();
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [clearReconnectTimer]);

  const connect = useCallback(
    (options: SSEConnectOptions) => {
      const {
        url,
        method = "GET",
        body,
        headers,
        auth,
        maxEvents = DEFAULT_MAX_EVENTS,
        eventFilter,
        autoReconnect = true,
        maxReconnects = 5,
      } = options;

      // Abort any existing connection and cancel a pending reconnection.
      abortRef.current?.abort();
      clearReconnectTimer();

      maxEventsRef.current = Math.min(Math.max(1, maxEvents), MAX_EVENTS_CAP);
      eventFilterRef.current = eventFilter || undefined;
      autoReconnectRef.current = autoReconnect;
      maxReconnectsRef.current = Math.max(0, maxReconnects);

      retryDelayRef.current = DEFAULT_RETRY_MS;
      reconnectAttemptsRef.current = 0;
      setReconnectCount(0);
      setStatus("connecting");
      setError(null);
      setStatusMessage(null);

      const abortController = new AbortController();
      abortRef.current = abortController;

      const fetchHeaders = buildFetchHeaders(headers, auth);
      if (body && !Object.keys(fetchHeaders).some((key) => key.toLowerCase() === "content-type")) {
        fetchHeaders["Content-Type"] = "application/json";
      }

      let eventCount = 0;
      let firstEventAt = 0;
      let failed = false;

      const addEvent = (data: string, eventType: string, lastEventId: string) => {
        if (isPausedRef.current) return;
        // Apply event filter
        if (eventFilterRef.current && eventType !== eventFilterRef.current) {
          return;
        }

        if (lastEventId) {
          lastEventIdsRef.current.set(url, lastEventId);
        }

        setEvents((prev) => {
          const limit = maxEventsRef.current;
          const next = prev.length >= limit ? prev.slice(-(limit - 1)) : prev;
          return [
            ...next,
            {
              id: lastEventId || `sse-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              event: eventType,
              data,
              timestamp: Date.now(),
            },
          ];
        });
        const bytes = new TextEncoder().encode(data).byteLength;
        eventCount += 1;
        firstEventAt ||= Date.now();
        setTotalBytes((previous) => previous + bytes);
        const elapsed = Math.max(1, Date.now() - firstEventAt);
        setEventsPerSec((eventCount * 1000) / elapsed);
      };

      const scheduleReconnect = () => {
        if (!autoReconnectRef.current || maxReconnectsRef.current <= 0) {
          setStatus("error");
          setError(lastErrorRef.current);
          return;
        }

        reconnectAttemptsRef.current += 1;
        const attempt = reconnectAttemptsRef.current;

        if (attempt > maxReconnectsRef.current) {
          const tentatives = maxReconnectsRef.current > 1 ? "tentatives" : "tentative";
          setStatus("error");
          setError(
            `La connexion a été perdue après ${maxReconnectsRef.current} ${tentatives} de reconnexion.`,
          );
          return;
        }

        setReconnectCount(attempt);
        setStatus("connecting");

        // Exponential backoff seeded by the server `retry:` hint, with jitter.
        const delay = Math.min(retryDelayRef.current * 2 ** (attempt - 1), MAX_RETRY_MS);
        const waitMs = Math.round(delay * (0.75 + Math.random() * 0.5));
        setStatusMessage(
          `Reconnexion automatique dans ${Math.max(1, Math.round(waitMs / 1000))} s (essai ${attempt}/${maxReconnectsRef.current})…`,
        );

        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          startStream();
        }, waitMs);
      };

      const startStream = () => {
        failed = false;

        // Build URL with lastEventId for reconnection if available
        const lastEventId = lastEventIdsRef.current.get(url);
        const connectUrl = lastEventId
          ? url + (url.includes("?") ? "&" : "?") + `lastEventId=${encodeURIComponent(lastEventId)}`
          : url;

        createSSEStream(connectUrl, {
          headers: fetchHeaders,
          method,
          body,
          signal: abortController.signal,
          onOpen: () => {
            if (abortRef.current !== abortController) return;
            setStatus("open");
            setStatusMessage(null);
          },
          onMessage: (data, eventType, lastEventId) => {
            if (abortRef.current !== abortController) return;
            addEvent(data, eventType, lastEventId);
          },
          onRetry: (retryMs) => {
            retryDelayRef.current = retryMs;
          },
          onError: (err, retryable) => {
            if (abortRef.current !== abortController) return;
            failed = true;
            lastErrorRef.current = err.message;
            // HTTP errors (401, 404, …) won't be fixed by retrying.
            if (retryable === false) {
              setStatus("error");
              setError(err.message);
              return;
            }
            scheduleReconnect();
          },
        }).then(() => {
          // The stream ended (server closed the connection): retry unless the
          // connection already failed, the user disconnected or a newer
          // connection replaced this one.
          if (abortRef.current !== abortController || failed) return;
          scheduleReconnect();
        });
      };

      startStream();
    },
    [clearReconnectTimer],
  );

  const disconnect = useCallback(() => {
    clearReconnectTimer();
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus("closed");
    setStatusMessage(null);
  }, [clearReconnectTimer]);

  const clearEvents = useCallback(() => {
    setEvents([]);
    setTotalBytes(0);
    setEventsPerSec(0);
  }, []);

  const togglePause = useCallback(() => setIsPaused((paused) => !paused), []);

  return {
    status,
    events,
    error,
    statusMessage,
    totalBytes,
    eventsPerSec,
    isPaused,
    reconnectCount,
    connect,
    disconnect,
    clearEvents,
    togglePause,
  };
}

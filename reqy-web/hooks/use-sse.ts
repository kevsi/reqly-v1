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
  headers?: KeyValuePair[];
  auth?: SSEAuthConfig;
  maxEvents?: number;
  eventFilter?: string;
}

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
  onMessage?: (data: string, eventType: string, lastEventId: string) => void;
  onOpen?: () => void;
  onError?: (error: Error) => void;
  signal?: AbortSignal;
}

function parseSSEField(line: string): [string, string] {
  const colonIdx = line.indexOf(":");
  if (colonIdx === -1) return [line, ""];
  let value = line.slice(colonIdx + 1);
  if (value.startsWith(" ")) value = value.slice(1);
  return [line.slice(0, colonIdx), value];
}

async function createSSEStream(
  url: string,
  { headers = {}, onMessage, onOpen, onError, signal }: SSEStreamCallbacks,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url, { headers, signal });
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") return;
    const error = err instanceof Error ? err : new Error(String(err));
    onError?.(error);
    return;
  }

  if (!response.ok) {
    onError?.(new Error(`SSE connection failed: ${response.status} ${response.statusText}`));
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    onError?.(new Error("SSE: Response body is not readable"));
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let lastEventId = "";
  let currentEvent = "";
  let currentData: string[] = [];

  onOpen?.();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        // Comment lines (starting with colon) are ignored
        if (line.startsWith(":")) continue;

        // Empty line dispatches the event
        if (line === "") {
          const data = currentData.join("\n");
          if (data) {
            onMessage?.(data, currentEvent || "message", lastEventId);
          }
          currentEvent = "";
          currentData = [];
          continue;
        }

        const [field, fieldValue] = parseSSEField(line);

        switch (field) {
          case "event":
            currentEvent = fieldValue;
            break;
          case "data":
            currentData.push(fieldValue);
            break;
          case "id":
            if (fieldValue) lastEventId = fieldValue;
            break;
          case "retry":
            // retry time — not needed for fetch-based approach
            break;
        }
      }
    }
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") return;
    const error = err instanceof Error ? err : new Error(String(err));
    onError?.(error);
    return;
  }
}

export function useSSE() {
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [status, setStatus] = useState<SSEStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastEventIdRef = useRef<string | undefined>(undefined);
  const maxEventsRef = useRef(500);
  const eventFilterRef = useRef<string | undefined>(undefined);

  const connect = useCallback((options: SSEConnectOptions) => {
    const { url, headers, auth, maxEvents = 500, eventFilter } = options;

    // Abort any existing connection
    abortRef.current?.abort();

    maxEventsRef.current = Math.min(Math.max(1, maxEvents), 5000);
    eventFilterRef.current = eventFilter || undefined;

    setStatus("connecting");
    setError(null);

    const abortController = new AbortController();
    abortRef.current = abortController;

    const fetchHeaders = buildFetchHeaders(headers, auth);

    // Build URL with lastEventId for reconnection if available
    const connectUrl = lastEventIdRef.current
      ? url +
        (url.includes("?") ? "&" : "?") +
        `lastEventId=${encodeURIComponent(lastEventIdRef.current)}`
      : url;

    const addEvent = (data: string, eventType: string, lastEventId: string) => {
      // Apply event filter
      if (eventFilterRef.current && eventType !== eventFilterRef.current) {
        return;
      }

      if (lastEventId) {
        lastEventIdRef.current = lastEventId;
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
    };

    createSSEStream(connectUrl, {
      headers: fetchHeaders,
      signal: abortController.signal,
      onOpen: () => {
        setStatus("open");
      },
      onMessage: (data, eventType, lastEventId) => {
        addEvent(data, eventType, lastEventId);
      },
      onError: (err) => {
        setStatus("error");
        setError(err.message || "Connection lost");
      },
    }).then(() => {
      // Stream ended normally (server closed the connection)
      if (abortRef.current === abortController) {
        setStatus("closed");
      }
    });
  }, []);

  const disconnect = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus("closed");
  }, []);

  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  return { status, events, error, connect, disconnect, clearEvents };
}

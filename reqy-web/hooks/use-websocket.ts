"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type { KeyValuePair } from "@/components/key-value-editor";
import { isTauriAvailable } from "@/lib/tauri";
import {
  type WsTimelineEntry,
  makeEntryId,
  pushTimelineEntry,
  WS_TIMELINE_CAP,
} from "@/lib/websocket-utils";

export type WsStatus = "idle" | "connecting" | "open" | "closed" | "error";

export interface WsConnectOptions {
  url: string;
  headers?: KeyValuePair[];
  subprotocols?: string;
}

interface WsMessagePayload {
  connectionId: string;
  kind: string;
  data: string;
  byteLen: number;
  timestamp: number;
}

interface WsStatusPayload {
  connectionId: string;
  status: string;
  reason?: string;
}

/**
 * Client WebSocket desktop : la connexion vit côté Rust (tokio-tungstenite)
 * pour accepter les en-têtes personnalisés — impossibles avec l'API
 * `WebSocket` du webview. Les messages arrivent via les événements Tauri
 * `ws-message` / `ws-status`. Fallback navigateur : WebSocket natif sans
 * en-têtes personnalisés (dev web uniquement ; l'app cible le desktop).
 */
export function useWebSocket() {
  const [status, setStatus] = useState<WsStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<WsTimelineEntry[]>([]);
  const [bytesIn, setBytesIn] = useState(0);
  const [bytesOut, setBytesOut] = useState(0);

  const connectionIdRef = useRef<string | null>(null);
  const unlistenRefs = useRef<Array<() => void>>([]);
  const nativeWsRef = useRef<WebSocket | null>(null);
  const statusRef = useRef<WsStatus>("idle");

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const cleanupListeners = useCallback(() => {
    unlistenRefs.current.forEach((fn) => fn());
    unlistenRefs.current = [];
  }, []);

  const cleanup = useCallback(() => {
    cleanupListeners();
    connectionIdRef.current = null;
    if (nativeWsRef.current) {
      nativeWsRef.current.onopen = null;
      nativeWsRef.current.onclose = null;
      nativeWsRef.current.onerror = null;
      nativeWsRef.current.onmessage = null;
      try {
        nativeWsRef.current.close();
      } catch {
        /* déjà fermée */
      }
      nativeWsRef.current = null;
    }
  }, [cleanupListeners]);

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  const addEntry = useCallback((entry: WsTimelineEntry) => {
    setMessages((prev) => pushTimelineEntry(prev, entry, WS_TIMELINE_CAP));
  }, []);

  const connect = useCallback(
    (options: WsConnectOptions) => {
      const url = options.url.trim();
      if (!url) return;

      cleanup();
      setMessages([]);
      setBytesIn(0);
      setBytesOut(0);
      setError(null);
      setStatus("connecting");

      const headers = (options.headers ?? []).filter(
        (h) => h.key && h.value !== undefined && h.enabled !== false,
      );

      const terminal = (next: WsStatus, reason?: string | null) => {
        // Ne jamais écraser un état terminal par un événement retardé.
        if (
          statusRef.current === "closed" ||
          (statusRef.current === "error" && next === "closed")
        ) {
          return;
        }
        setStatus(next);
        setError(next === "error" ? reason || "La connexion a échoué." : null);
      };

      if (!isTauriAvailable()) {
        // Fallback dev web : WebSocket natif, pas d'en-têtes personnalisés.
        const subprotocols = (options.subprotocols ?? "")
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean);
        let ws: WebSocket;
        try {
          ws = subprotocols.length ? new WebSocket(url, subprotocols) : new WebSocket(url);
        } catch (err) {
          setStatus("error");
          setError(err instanceof Error ? err.message : String(err));
          return;
        }
        nativeWsRef.current = ws;
        ws.binaryType = "arraybuffer";
        ws.onopen = () => setStatus("open");
        ws.onmessage = (event) => {
          if (typeof event.data === "string") {
            setBytesIn((b) => b + event.data.length);
            addEntry({
              id: makeEntryId("ws-in"),
              direction: "in",
              kind: "text",
              data: event.data,
              byteLen: event.data.length,
              timestamp: Date.now(),
            });
          } else {
            const buffer = event.data as ArrayBuffer;
            const bytes = new Uint8Array(buffer);
            let binary = "";
            for (let i = 0; i < bytes.length; i += 1) {
              binary += String.fromCharCode(bytes[i]);
            }
            const encoded = btoa(binary);
            setBytesIn((b) => b + bytes.length);
            addEntry({
              id: makeEntryId("ws-in"),
              direction: "in",
              kind: "binary",
              data: encoded,
              byteLen: bytes.length,
              timestamp: Date.now(),
            });
          }
        };
        ws.onerror = () => terminal("error", "La connexion WebSocket a échoué.");
        ws.onclose = (event) => {
          if (statusRef.current === "connecting") {
            terminal("error", `Connexion refusée (code ${event.code}).`);
          } else {
            terminal("closed");
          }
        };
        return;
      }

      // Desktop : connexion Rust + événements Tauri.
      (async () => {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const { listen } = await import("@tauri-apps/api/event");

          const unlistenMessage = await listen<WsMessagePayload>("ws-message", (event) => {
            if (event.payload.connectionId !== connectionIdRef.current) return;
            const kind = event.payload.kind === "ping" ? "ping" : event.payload.kind;
            if (kind !== "binary") setBytesIn((b) => b + event.payload.byteLen);
            addEntry({
              id: makeEntryId("ws-in"),
              direction: "in",
              kind,
              data: event.payload.data,
              byteLen: event.payload.byteLen,
              timestamp: event.payload.timestamp || Date.now(),
            });
          });
          const unlistenStatus = await listen<WsStatusPayload>("ws-status", (event) => {
            if (event.payload.connectionId !== connectionIdRef.current) return;
            if (event.payload.status === "open") {
              setStatus("open");
              setError(null);
            } else if (event.payload.status === "closed") {
              terminal("closed", event.payload.reason);
            } else {
              terminal("error", event.payload.reason);
            }
          });
          unlistenRefs.current = [unlistenMessage, unlistenStatus];

          const result = await invoke<{ connectionId: string }>("ws_connect", {
            url,
            headers: headers.map((h) => [h.key, h.value]),
            subprotocols: (options.subprotocols ?? "")
              .split(",")
              .map((p) => p.trim())
              .filter(Boolean),
          });
          connectionIdRef.current = result.connectionId;
          setStatus("open");
        } catch (err) {
          if (connectionIdRef.current === null) {
            terminal("error", err instanceof Error ? err.message : String(err));
          }
        }
      })();
    },
    [addEntry, cleanup],
  );

  const send = useCallback(async (data: string, binaryBase64?: boolean) => {
    const kind = binaryBase64 ? "binary" : "text";
    const byteLen = binaryBase64
      ? Math.floor((data.length * 3) / 4)
      : data.length;
    setBytesOut((b) => b + byteLen);
    addEntry({
      id: makeEntryId("ws-out"),
      direction: "out",
      kind,
      data,
      byteLen,
      timestamp: Date.now(),
    });

    if (!isTauriAvailable()) {
      const ws = nativeWsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        setStatus("error");
        setError("Aucune connexion WebSocket active.");
        return;
      }
      if (binaryBase64) {
        const raw = atob(data);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
        ws.send(bytes.buffer);
      } else {
        ws.send(data);
      }
      return;
    }

    const connectionId = connectionIdRef.current;
    if (!connectionId) {
      setStatus("error");
      setError("Aucune connexion WebSocket active.");
      return;
    }
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("ws_send", { connectionId, data, binary: binaryBase64 ?? false });
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [addEntry]);

  const disconnect = useCallback(async (code?: number, reason?: string) => {
    const connectionId = connectionIdRef.current;
    cleanup();
    setStatus("closed");
    setError(null);

    if (isTauriAvailable() && connectionId) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("ws_close", { connectionId, code, reason });
      } catch {
        /* connexion déjà fermée côté Rust */
      }
    }
  }, [cleanup]);

  const clearMessages = useCallback(() => setMessages([]), []);

  return {
    status,
    error,
    messages,
    bytesIn,
    bytesOut,
    connect,
    send,
    disconnect,
    clearMessages,
  };
}

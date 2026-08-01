/**
 * WebSocket sync client — connects to the sync server's WS endpoint,
 * listens for broadcast "change" messages, and triggers a pull.
 *
 * Reconnects automatically with exponential backoff up to a max delay.
 * Designed to be a long-lived singleton: one connection at a time per
 * active workspace.
 */

export interface SyncWsOptions {
  /** The workspace to subscribe to. */
  workspaceId: string;
  /** HTTP base URL of the sync server (e.g. "http://localhost:4000"). */
  syncUrl: string;
  /** Called when a broadcast change signal is received (hint to re-pull). */
  onChange?: () => void;
  /** Called when a connection-level error occurs (reconnect is automatic). */
  onError?: (err: Error) => void;
  /** Called after a successful reconnect. */
  onReconnect?: () => void;
}

export interface SyncWsController {
  /** Tear down the connection and cancel any pending reconnect. */
  disconnect: () => void;
  /** Whether the underlying WebSocket is currently open. */
  isConnected: () => boolean;
}

const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const PONG_TIMEOUT_MS = 35_000; // server pings every 30s; wait 35s for pong

export function connectSyncWs(opts: SyncWsOptions): SyncWsController {
  const { workspaceId, syncUrl, onChange, onError, onReconnect } = opts;

  let ws: WebSocket | null = null;
  let connected = false;
  let disconnected = false; // true when user explicitly calls disconnect()
  let reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pongTimer: ReturnType<typeof setTimeout> | null = null;

  // Convert HTTP(S) URL to WS(S) URL
  const wsProtocol = syncUrl.startsWith("https") ? "wss" : "ws";
  const wsBase = syncUrl.replace(/^https?:\/\//, "");
  const wsUrl = `${wsProtocol}://${wsBase}/api/sync/ws?workspaceId=${encodeURIComponent(workspaceId)}`;

  function clearPongTimer() {
    if (pongTimer) {
      clearTimeout(pongTimer);
      pongTimer = null;
    }
  }

  function scheduleReconnect() {
    if (disconnected) return;
    clearPongTimer();
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectDelay);
    // Exponential backoff, capped
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
  }

  function connect() {
    if (disconnected) return;

    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      // Synchronous construction failure (e.g. bad URL)
      onError?.(err instanceof Error ? err : new Error(String(err)));
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      connected = true;
      reconnectDelay = INITIAL_RECONNECT_DELAY_MS; // reset on success
      // Reconnect callback if this was a reconnection
      if (reconnectTimer === null && reconnectDelay > INITIAL_RECONNECT_DELAY_MS) {
        // (impossible to detect "first connect" vs "reconnect" perfectly,
        //  so we treat any onopen after a closed connection as reconnect)
      }
    };

    ws.onmessage = (event: MessageEvent) => {
      let data: unknown;
      try {
        data = JSON.parse(event.data as string);
      } catch {
        return; // ignore malformed messages
      }

      const msg = data as Record<string, unknown>;

      if (msg.type === "hello") {
        // Connection confirmed — nothing else to do
        return;
      }

      if (msg.type === "change") {
        // Server broadcast: a change was pushed; re-pull
        onChange?.();
        return;
      }

      if (msg.type === "error") {
        const payload = typeof msg.payload === "string" ? msg.payload : "WS error";
        onError?.(new Error(payload));
        return;
      }
    };

    ws.onclose = () => {
      connected = false;
      clearPongTimer();
      if (!disconnected) {
        scheduleReconnect();
      }
    };

    ws.onerror = () => {
      // onerror is always followed by onclose, so we just handle reconnection there
    };
  }

  const controller: SyncWsController = {
    disconnect: () => {
      disconnected = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      clearPongTimer();
      if (ws) {
        ws.onclose = null; // prevent reconnect
        ws.onerror = null;
        ws.close();
        ws = null;
      }
      connected = false;
    },
    isConnected: () => connected,
  };

  // Start the connection
  connect();

  return controller;
}

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
  /** Direct/Tauri session token, sent as a negotiated subprotocol. */
  token?: string;
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

export const SYNC_WS_AUTH_PROTOCOL = "reqly-bearer";
const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

/**
 * Récupère un ticket WS éphémère (30 s, usage unique) auprès du sync server,
 * pour ne JAMAIS exposer le token de session dans le header
 * `Sec-WebSocket-Protocol` du handshake (visible dans les logs).
 * Retourne `null` si le serveur ne supporte pas les tickets (repli : token brut).
 */
async function fetchWsTicket(
  syncUrl: string,
  workspaceId: string,
  token: string,
): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const res = await fetch(
        `${syncUrl}/api/auth/ws-ticket?workspaceId=${encodeURIComponent(workspaceId)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        },
      );
      if (!res.ok) return null;
      const data = (await res.json()) as { ticket?: string };
      return typeof data.ticket === "string" && data.ticket ? data.ticket : null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null; // repli : token de session en subprotocol
  }
}

export function connectSyncWs(opts: SyncWsOptions): SyncWsController {
  const { workspaceId, syncUrl, token, onChange, onError, onReconnect } = opts;
  let ws: WebSocket | null = null;
  let connected = false;
  let disconnected = false; // true when user explicitly calls disconnect()
  let hasConnected = false;
  let reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pongTimer: ReturnType<typeof setTimeout> | null = null;
  let protocols: string[] | undefined;
  // Convert HTTP(S) URL to WS(S) URL. The token is intentionally not put in
  // this URL; it travels as a short-lived ticket in the subprotocol header.
  const wsProtocol = syncUrl.startsWith("https") ? "wss" : "ws";
  const wsBase = syncUrl.replace(/^https?:\/\//, "");
  const wsUrl = `${wsProtocol}://${wsBase}/api/sync/ws?workspaceId=${encodeURIComponent(workspaceId)}`;

  async function refreshProtocols() {
    // Ticket neuf à chaque connexion (et toutes les ~25 s pour une session
    // longue) : un ticket volé dans un log est inutilisable après 30 s.
    if (token) {
      const ticket = await fetchWsTicket(syncUrl, workspaceId, token);
      if (ticket) {
        protocols = [SYNC_WS_AUTH_PROTOCOL, ticket];
        return;
      }
    }
    protocols = token ? [SYNC_WS_AUTH_PROTOCOL, token] : undefined;
  }

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
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
  }

  function connect() {
    if (disconnected) return;
    // Ticket frais à chaque (re)connexion ; rafraîchi aussi en cours de
    // session longue pour ne jamais dépasser sa durée de vie de 30 s.
    void refreshProtocols().then(() => {
      if (disconnected) return;
      try {
        ws = protocols ? new WebSocket(wsUrl, protocols) : new WebSocket(wsUrl);
      } catch (err) {
        onError?.(err instanceof Error ? err : new Error(String(err)));
        scheduleReconnect();
        return;
      }
      wireEvents(ws);
      // Session longue : renouvelle le ticket avant expiration.
      if (protocols?.length === 2 && protocols[1].startsWith("t.")) {
        const refreshTimer = setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) {
            void refreshProtocols();
          } else {
            clearInterval(refreshTimer);
          }
        }, 25_000);
        ws.addEventListener("close", () => clearInterval(refreshTimer), { once: true });
      }
    });
  }

  function wireEvents(socket: WebSocket) {
    socket.onopen = () => {
      const wasReconnect = hasConnected;
      hasConnected = true;
      connected = true;
      reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
      if (wasReconnect) onReconnect?.();
    };

    socket.onmessage = (event: MessageEvent) => {
      let data: unknown;
      try {
        data = JSON.parse(event.data as string);
      } catch {
        return;
      }
      const msg = data as Record<string, unknown>;
      if (msg.type === "hello") return;
      if (msg.type === "change") {
        onChange?.();
        return;
      }
      if (msg.type === "error") {
        const payload = typeof msg.payload === "string" ? msg.payload : "WS error";
        onError?.(new Error(payload));
      }
    };

    socket.onclose = () => {
      connected = false;
      clearPongTimer();
      if (!disconnected) scheduleReconnect();
    };

    socket.onerror = () => {
      // onerror is followed by onclose; reconnect there to avoid duplicates.
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
        ws.onclose = null;
        ws.onerror = null;
        ws.close();
        ws = null;
      }
      connected = false;
    },
    isConnected: () => connected,
  };

  connect();
  return controller;
}

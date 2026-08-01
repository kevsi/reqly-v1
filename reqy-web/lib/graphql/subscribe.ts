export interface SubscriptionMessage {
  type: "data" | "error" | "complete" | "connection_ack" | "ping" | "pong";
  payload?: unknown;
  id?: string;
}

export interface SubscriptionHandle {
  close: () => void;
  send: (data: unknown) => void;
}

export function subscribeGraphQL(
  endpoint: string,
  query: string,
  variables: Record<string, unknown> | undefined,
  headers: Record<string, string> | undefined,
  onMessage: (msg: SubscriptionMessage) => void,
): SubscriptionHandle {
  const wsUrl = endpoint.replace(/^http/i, "ws");

  // Browsers don't allow custom subprotocols alongside header authorization,
  // so we send headers as connection_init payload (graphql-ws spec).
  const initPayload: Record<string, unknown> = {};
  if (headers && Object.keys(headers).length > 0) {
    initPayload.headers = headers;
  }

  const ws = new WebSocket(wsUrl, "graphql-transport-ws");

  let operationId: string | null = null;
  let ackReceived = false;
  let pendingSubscribe: (() => void) | null = null;

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "connection_init", payload: initPayload }));
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data) as SubscriptionMessage;

      // Handle connection_ack per graphql-ws spec — only send subscribe after ack
      if (msg.type === "connection_ack") {
        ackReceived = true;
        if (pendingSubscribe) {
          pendingSubscribe();
          pendingSubscribe = null;
        }
      } else {
        onMessage(msg);
      }
    } catch {
      // ignore malformed messages
    }
  };

  ws.onerror = () => {
    onMessage({ type: "error", payload: "WebSocket error" });
  };

  // Send subscribe after connection_ack (per graphql-ws spec)
  const scheduleSubscribe = () => {
    const doSubscribe = () => {
      operationId = `op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      ws.send(
        JSON.stringify({
          id: operationId,
          type: "subscribe",
          payload: { query, variables: variables ?? {} },
        }),
      );
    };

    if (ackReceived) {
      doSubscribe();
    } else {
      pendingSubscribe = doSubscribe;
    }
  };

  if (ws.readyState === WebSocket.OPEN) {
    scheduleSubscribe();
  } else {
    ws.addEventListener("open", () => scheduleSubscribe(), { once: true });
  }

  return {
    close: () => {
      try {
        if (operationId && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ id: operationId, type: "complete" }));
        }
      } catch {
        // ignore
      }
      try {
        ws.close();
      } catch {
        // ignore
      }
    },
    send: (data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "data", payload: data }));
      }
    },
  };
}

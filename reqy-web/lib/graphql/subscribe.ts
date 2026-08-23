import { validateSubscriptionEndpoint } from "./errors";

export interface SubscriptionMessage {
  type: "data" | "error" | "complete" | "connection_ack" | "ping" | "pong";
  payload?: unknown;
  id?: string;
}

export interface SubscriptionHandle {
  close: () => void;
  send: (data: unknown) => void;
}

/** Handle "no-op" renvoyé quand l'URL de subscription est invalide. */
function noopHandle(): SubscriptionHandle {
  return { close: () => {}, send: () => {} };
}

export function subscribeGraphQL(
  endpoint: string,
  query: string,
  variables: Record<string, unknown> | undefined,
  headers: Record<string, string> | undefined,
  onMessage: (msg: SubscriptionMessage) => void,
): SubscriptionHandle {
  // Validation de l'URL (mêmes règles que pour une requête : schéma + format,
  // refus du mixed content) — l'erreur est remontée via onMessage.
  const validated = validateSubscriptionEndpoint(endpoint);
  if (!validated.ok) {
    onMessage({ type: "error", payload: validated.error });
    return noopHandle();
  }
  const wsUrl = validated.url;

  // Browsers don't allow custom subprotocols alongside header authorization,
  // so we send headers as connection_init payload (graphql-ws spec).
  const initPayload: Record<string, unknown> = {};
  if (headers && Object.keys(headers).length > 0) {
    initPayload.headers = headers;
  }

  let ws: WebSocket;
  try {
    ws = new WebSocket(wsUrl, "graphql-transport-ws");
  } catch {
    onMessage({
      type: "error",
      payload: "Connexion WebSocket impossible : URL invalide pour les subscriptions.",
    });
    return noopHandle();
  }

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
    onMessage({
      type: "error",
      payload:
        "Connexion WebSocket impossible : vérifiez que le serveur GraphQL accepte les subscriptions (protocole graphql-ws) et que l'URL est correcte.",
    });
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

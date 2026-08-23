import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, WebSocket } from "ws";
import { parseSessionCookie, isSessionRevoked, escapeRegex } from "../auth.js";
import { verifyWsTicket, type WsTicketPayload } from "../ws-ticket.js";
import { isMember } from "../sync-engine.js";
import { addClient, removeClient, type Client } from "../ws-hub.js";

const COOKIE_NAME = "auth_session";
export const SYNC_WS_AUTH_PROTOCOL = "reqly-bearer";

export function extractWsProtocolToken(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header.join(",") : header;
  const protocols = value
    ?.split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (protocols?.[0] !== SYNC_WS_AUTH_PROTOCOL) return undefined;
  return protocols[1];
}
const PING_INTERVAL_MS = 30_000;

function isOriginAllowed(origin: string | undefined, allowedOrigins: string[] | "*"): boolean {
  if (!origin) return false;
  if (allowedOrigins === "*") return true;
  return allowedOrigins.some((o) => o.toLowerCase() === origin.toLowerCase());
}

export function handleWsUpgradeFactory(allowedOrigins: string[] | "*") {
  return function handleWsUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    wss: WebSocketServer,
  ) {
    // Check origin BEFORE any upgrade
    const origin = req.headers.origin;
    if (!isOriginAllowed(origin, allowedOrigins)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    const cookieHeader = req.headers.cookie ?? "";
    const protocolToken = extractWsProtocolToken(req.headers["sec-websocket-protocol"]);

    const url = new URL(req.url ?? "/", "http://localhost");
    const workspaceId = url.searchParams.get("workspaceId");
    if (!workspaceId) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }

    // Authentification :
    //  1. Ticket WS à usage unique (subprotocol) — privilégié : le token de
    //     session n'est jamais exposé dans l'en-tête de handshake.
    //  2. Repli : cookie auth_session, header Authorization: Bearer, ou
    //     token de session en subprotocol (clients plus anciens).
    // Le handshake ne lit que userId/ver/exp : une session issue d'un ticket
    // ne porte pas les champs email/name/provider du token complet.
    let session:
      | ReturnType<typeof parseSessionCookie>
      | { userId: string; ver?: number; exp?: number }
      | null = null;
    let ticketPayload: WsTicketPayload | null = null;
    if (protocolToken && protocolToken.startsWith("t.")) {
      ticketPayload = verifyWsTicket(protocolToken);
      if (ticketPayload && ticketPayload.wid !== workspaceId) {
        ticketPayload = null; // ticket lié à un autre workspace
      }
      if (ticketPayload) {
        session = {
          userId: ticketPayload.uid,
          ver: ticketPayload.ver ?? 0,
          exp: ticketPayload.exp,
        };
      }
    }
    if (!session) {
      const rawToken =
        cookieHeader.match(new RegExp(`${escapeRegex(COOKIE_NAME)}=([^;]+)`))?.[1] ??
        (req.headers.authorization?.startsWith("Bearer ")
          ? req.headers.authorization.slice(7).trim()
          : protocolToken);
      try {
        session = parseSessionCookie(rawToken);
      } catch {
        // AUTH_SIGNING_SECRET missing in a misconfigured deploy — don't crash
        // the upgrade event, just reject the connection.
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
    }
    if (!session || !session.userId) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    // Reject revoked sessions (token_version bumped on logout).
    if (isSessionRevoked(session.userId, session.ver)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    if (!isMember(workspaceId, session.userId)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (wsConn: WebSocket) => {
      const client: Client = { ws: wsConn, userId: session.userId!, workspaceId };
      addClient(client);

      wsConn.on("pong", () => {
        // Keepalive response received; no-op (just resets the ping timer below)
      });

      // Keepalive: ping every PING_INTERVAL_MS; if no pong, terminate
      const pingInterval = setInterval(() => {
        if (wsConn.readyState !== WebSocket.OPEN) {
          clearInterval(pingInterval);
          return;
        }
        wsConn.ping();
      }, PING_INTERVAL_MS);

      // Periodic session re-verification: re-validate the token against
      // its embedded expiry every 60s.  The token string captured at upgrade
      // time is stored and re-checked because parseSessionCookie validates
      // expiry.  If the session token has expired, terminate the connection.
      // (Ticket-auth : on ne re-vérifie que la révocation — le ticket est
      // éphémère, la session, elle, reste valide.)
      const sessionRecheck = setInterval(() => {
        if (wsConn.readyState !== WebSocket.OPEN) {
          clearInterval(sessionRecheck);
          return;
        }
        const expired = session?.exp != null && session.exp < Date.now();
        const revoked = !session?.userId || isSessionRevoked(session.userId, session.ver);
        if (expired || revoked) {
          clearInterval(sessionRecheck);
          wsConn.send(JSON.stringify({ type: "error", payload: "Session expired" }));
          wsConn.close(4001, "Session expired");
        }
      }, 60_000);

      // Single cleanup path: remove the client from the hub and stop BOTH
      // timers. Registered once for "close" and once for "error" — removeClient
      // and clearInterval are idempotent, so double-firing stays harmless.
      let closed = false;
      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(pingInterval);
        clearInterval(sessionRecheck);
        removeClient(client);
      };
      wsConn.on("close", cleanup);
      wsConn.on("error", cleanup);

      // Send hello
      try {
        wsConn.send(JSON.stringify({ type: "hello", workspaceId }));
      } catch {
        // ignore: socket may already be closing
      }
    });
  };
}

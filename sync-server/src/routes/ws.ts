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
    // Le handshake ne lit que userId/ver : une session issue d'un ticket ne
    // porte pas les champs email/name/provider du token complet.
    // `rawSessionToken` garde le token cookie/bearer pour que le recheck
    // périodique puisse re-valider sa propre expiration (`expires`) — le `exp`
    // du ticket, lui, est éphémère (30 s) et NE DOIT PAS être propagé à la
    // session, sous peine de tuer la connexion WS une minute après son ouverture.
    let session: { userId: string; ver?: number } | null = null;
    let rawSessionToken: string | null = null;
    let ticketPayload: WsTicketPayload | null = null;
    if (protocolToken && protocolToken.startsWith("t.")) {
      ticketPayload = verifyWsTicket(protocolToken);
      if (ticketPayload && ticketPayload.wid !== workspaceId) {
        ticketPayload = null; // ticket lié à un autre workspace
      }
      if (ticketPayload) {
        session = { userId: ticketPayload.uid as string, ver: ticketPayload.ver ?? 0 };
      }
    }
    if (!session) {
      rawSessionToken =
        cookieHeader.match(new RegExp(`${escapeRegex(COOKIE_NAME)}=([^;]+)`))?.[1] ??
        (req.headers.authorization?.startsWith("Bearer ")
          ? req.headers.authorization.slice(7).trim()
          : protocolToken) ??
        null;
      try {
        session = parseSessionCookie(rawSessionToken ?? undefined) as { userId: string; ver?: number };
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

      // Periodic session re-verification (60 s):
      //  - cookie/bearer sessions: re-parse the original token so its own
      //    `expires` is enforced (a WS must not outlive its session token);
      //  - ticket sessions: the ticket is ephemeral by design — only the
      //    revocation and the membership are re-checked, never the ticket TTL;
      //  - membership: a member removed mid-connection stops receiving
      //    workspace broadcasts at the next tick.
      const sessionRecheck = setInterval(() => {
        if (wsConn.readyState !== WebSocket.OPEN) {
          clearInterval(sessionRecheck);
          return;
        }
        let expired = false;
        if (rawSessionToken) {
          try {
            expired = parseSessionCookie(rawSessionToken) === null;
          } catch {
            expired = true;
          }
        }
        const revoked = !session?.userId || isSessionRevoked(session.userId, session.ver);
        const left = !session?.userId || !isMember(workspaceId, session.userId);
        if (expired || revoked || left) {
          clearInterval(sessionRecheck);
          try {
            wsConn.send(JSON.stringify({ type: "error", payload: "Session expired" }));
          } catch {
            // socket may already be closing
          }
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

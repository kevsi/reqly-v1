import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, WebSocket } from "ws";
import { parseSessionCookie, isSessionRevoked, escapeRegex } from "../auth.js";
import { isMember } from "../sync-engine.js";
import { addClient, removeClient, type Client } from "../ws-hub.js";

const COOKIE_NAME = "auth_session";
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
    const rawToken =
      cookieHeader.match(new RegExp(`${escapeRegex(COOKIE_NAME)}=([^;]+)`))?.[1] ??
      // Accept the Bearer token too, so desktop/Tauri clients (which hold a
      // token but no cookie) can open the WebSocket.
      (req.headers.authorization?.startsWith("Bearer ")
        ? req.headers.authorization.slice(7).trim()
        : undefined);
    let session: ReturnType<typeof parseSessionCookie>;
    try {
      session = parseSessionCookie(rawToken);
    } catch {
      // AUTH_SIGNING_SECRET missing in a misconfigured deploy — don't crash
      // the upgrade event, just reject the connection.
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
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

    const url = new URL(req.url ?? "/", "http://localhost");
    const workspaceId = url.searchParams.get("workspaceId");
    if (!workspaceId) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
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

      const cleanup = () => removeClient(client);
      wsConn.on("close", cleanup);
      wsConn.on("error", cleanup);

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

      wsConn.on("close", () => clearInterval(pingInterval));
      wsConn.on("error", () => clearInterval(pingInterval));

      // Periodic session re-verification: re-validate the token against
      // its embedded expiry every 60s.  The token string captured at upgrade
      // time is stored and re-checked because parseSessionCookie validates
      // expiry.  If the session token has expired, terminate the connection.
      const sessionRecheck = setInterval(() => {
        if (wsConn.readyState !== WebSocket.OPEN) {
          clearInterval(sessionRecheck);
          return;
        }
        const reSession = parseSessionCookie(rawToken);
        if (!reSession || !reSession.userId || isSessionRevoked(reSession.userId, reSession.ver)) {
          clearInterval(sessionRecheck);
          wsConn.send(JSON.stringify({ type: "error", payload: "Session expired" }));
          wsConn.close(4001, "Session expired");
        }
      }, 60_000);

      // Send hello
      try {
        wsConn.send(JSON.stringify({ type: "hello", workspaceId }));
      } catch {
        // ignore: socket may already be closing
      }

      // Extend cleanup to include the recheck timer
      const originalCleanup = cleanup;
      const cleanupWithTimers = () => {
        clearInterval(sessionRecheck);
        originalCleanup();
      };
      wsConn.on("close", cleanupWithTimers);
      wsConn.on("error", cleanupWithTimers);
    });
  };
}

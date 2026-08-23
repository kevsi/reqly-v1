// Load environment variables from sync-server/.env (dev) before any module
// reads process.env (db path, AUTH_SIGNING_SECRET, CORS origins, ...).
import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { WebSocketServer } from "ws";
import workspaces from "./routes/workspaces.js";
import memberships from "./routes/memberships.js";
import auth from "./routes/auth.js";
import sync from "./routes/sync.js";
import hooklet from "./routes/hooklet.js";
import hookletHooks from "./routes/hooklet-hooks.js";
import admin from "./routes/admin.js";
import { handleWsUpgradeFactory, SYNC_WS_AUTH_PROTOCOL } from "./routes/ws.js";
import { closeAll } from "./ws-hub.js";
import { parseOrigins } from "./cors.js";
import db from "./db.js";
import {
  apiLimiter,
  authLimiter,
  syncLimiter,
  wsLimiter,
  hookLimiter,
  rateLimitMiddleware,
} from "./rate-limiter.js";

if (process.env.AUTH_BYPASS === "true" && process.env.NODE_ENV === "production") {
  console.error("[reqly-sync] FATAL: AUTH_BYPASS is enabled in production. Refusing to start.");
  process.exit(1);
}

// Fail fast in production without a signing secret: every session token would
// otherwise be rejected (or, worse, signed with an empty secret).
if (process.env.NODE_ENV === "production" && !process.env.AUTH_SIGNING_SECRET) {
  console.error(
    "[reqly-sync] FATAL: AUTH_SIGNING_SECRET is not set in production. Refusing to start.",
  );
  process.exit(1);
}

if (
  process.env.NODE_ENV === "production" &&
  (!process.env.ALLOWED_ORIGIN || process.env.ALLOWED_ORIGIN === "*")
) {
  console.warn(
    "[reqly-sync] WARNING: NODE_ENV=production with ALLOWED_ORIGIN " +
      (process.env.ALLOWED_ORIGIN === "*" ? '"*"' : "unset") +
      ". Set it to the exact list of allowed origins — wildcard/unset CORS " +
      "breaks cookie credentials and exposes the API to any origin.",
  );
}

const app = new Hono();

const allowedOrigins = parseOrigins();

app.use(
  "*",
  cors({
    origin: (origin) => {
      if (!origin) {
        // Server-to-server or same-origin request without Origin header.
        // Return the first allowed origin as a safe default (client won't use it
        // without a matching Origin but it satisfies CORS protocol requirements).
        return allowedOrigins === "*" ? "*" : (allowedOrigins[0] ?? null);
      }
      if (allowedOrigins === "*") return origin; // echo back for credentials-less CORS
      if (allowedOrigins.includes(origin)) return origin;
      // Origin not in allowlist — block
      return null;
    },
    credentials: allowedOrigins !== "*",
  }),
);

// Health check: 200 only when the database answers, so orchestrators can
// restart a wedged instance (SQLite WAL lock, disk full, ...).
app.get("/health", (c) => {
  try {
    db.prepare("SELECT 1").get();
    return c.json({ status: "ok", db: true });
  } catch {
    return c.json({ status: "error", db: false }, 503);
  }
});

// Body size limit: rejects bodies larger than 5 MB. bodyLimit wraps the
// request stream with a byte counter, so Transfer-Encoding: chunked bodies
// (no content-length) are capped too — a header-only check is bypassable.
const MAX_BODY_BYTES = 5_242_880; // 5 MB
app.use(
  "/api/*",
  bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) => c.json({ error: "Request body too large (max 5 MB)" }, 413),
  }),
);

// Apply API-wide rate limiting (non-sync endpoints)
app.use("/api/workspaces/*", rateLimitMiddleware(apiLimiter));
app.use("/api/memberships/*", rateLimitMiddleware(apiLimiter));

// Auth endpoints get a dedicated, stricter limiter (login/register brute-force)
app.use("/api/auth/*", rateLimitMiddleware(authLimiter));

// Sync endpoints have a lower rate limit (bursty polling)
app.use("/api/sync/*", rateLimitMiddleware(syncLimiter));

// Public webhook ingest is unauthenticated — must be bounded to prevent
// DB/push exhaustion by anyone who learns a slug.
app.use("/api/hooks/*", rateLimitMiddleware(hookLimiter));

app.route("/api/workspaces", workspaces);
app.route("/api/memberships", memberships);
app.route("/api/auth", auth);
app.route("/api/sync", sync);
app.route("/api/hooklet", hooklet);
app.route("/api/hooks", hookletHooks);
// Admin surface: shared-secret bearer, stricter limiter.
app.use("/api/admin/*", rateLimitMiddleware(authLimiter));
app.route("/api/admin", admin);

// Global error handler — prevent stack traces leaking to clients
app.onError((err, c) => {
  console.error("[reqly-sync] Unhandled error:", err);
  return c.json({ error: "Erreur interne du serveur" }, 500);
});

const port = Number(process.env.PORT ?? 4000);

// @hono/node-server streams request bodies natively (no Buffer.concat),
// handles chunked transfer, and integrates with Node's HTTP server lifecycle.
const node = serve(
  {
    fetch: app.fetch,
    port,
    hostname: process.env.HOST ?? "0.0.0.0",
  },
  (info) => {
    console.log(`[reqly-sync] listening on http://${info.address}:${info.port}`);
  },
);

// maxPayload: the server never reads inbound messages, so a tiny cap prevents
// any single connection from pinning ~100 MiB (ws default) of receive buffer.
const wss = new WebSocketServer({
  noServer: true,
  maxPayload: 4096,
  handleProtocols: (protocols) =>
    protocols.has(SYNC_WS_AUTH_PROTOCOL) ? SYNC_WS_AUTH_PROTOCOL : false,
});

node.on("upgrade", (req, socket, head) => {
  if (req.url?.startsWith("/api/sync/ws")) {
    const forwardXff = process.env.TRUSTED_PROXY === "true";
    const ip = forwardXff
      ? req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
        req.headers["x-real-ip"] ||
        req.socket?.remoteAddress ||
        "unknown"
      : (req.socket?.remoteAddress ?? "unknown");
    const result = wsLimiter.check(`ws:${ip}`);
    if (!result.allowed) {
      socket.write("HTTP/1.1 429 Too Many Requests\r\n\r\n");
      socket.destroy();
      return;
    }
    handleWsUpgradeFactory(allowedOrigins)(req, socket, head, wss);
    return;
  }
  socket.destroy();
});

function shutdown() {
  console.log("[reqly-sync] shutting down");
  closeAll();
  apiLimiter.dispose();
  authLimiter.dispose();
  syncLimiter.dispose();
  wsLimiter.dispose();
  hookLimiter.dispose();
  node.close(() => process.exit(0));
  // Force exit after 5s if close hangs
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

export default {
  port,
  fetch: app.fetch,
};

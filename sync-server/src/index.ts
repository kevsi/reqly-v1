// Load environment variables from sync-server/.env (dev) before any module
// reads process.env (db path, AUTH_SIGNING_SECRET, CORS origins, ...).
import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { WebSocketServer } from "ws";
import workspaces from "./routes/workspaces.js";
import memberships from "./routes/memberships.js";
import auth from "./routes/auth.js";
import sync from "./routes/sync.js";
import { handleWsUpgradeFactory } from "./routes/ws.js";
import { closeAll } from "./ws-hub.js";
import { parseOrigins } from "./cors.js";
import { apiLimiter, syncLimiter, wsLimiter, rateLimitMiddleware } from "./rate-limiter.js";

if (process.env.AUTH_BYPASS === "true" && process.env.NODE_ENV === "production") {
  console.error("[reqly-sync] FATAL: AUTH_BYPASS is enabled in production. Refusing to start.");
  process.exit(1);
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

app.get("/health", (c) => c.json({ status: "ok" }));

// Body size limit: reject bodies larger than 5 MB to prevent resource exhaustion
const MAX_BODY_BYTES = 5_242_880; // 5 MB
app.use("/api/*", async (c, next) => {
  const contentLength = c.req.header("content-length");
  if (contentLength) {
    const len = Number(contentLength);
    if (!Number.isNaN(len) && len > MAX_BODY_BYTES) {
      return c.json({ error: "Request body too large (max 5 MB)" }, 413);
    }
  }
  return next();
});

// Apply API-wide rate limiting (non-sync endpoints)
app.use("/api/workspaces/*", rateLimitMiddleware(apiLimiter));
app.use("/api/memberships/*", rateLimitMiddleware(apiLimiter));
app.use("/api/auth/*", rateLimitMiddleware(apiLimiter));

// Sync endpoints have a lower rate limit (bursty polling)
app.use("/api/sync/*", rateLimitMiddleware(syncLimiter));

app.route("/api/workspaces", workspaces);
app.route("/api/memberships", memberships);
app.route("/api/auth", auth);
app.route("/api/sync", sync);

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

const wss = new WebSocketServer({ noServer: true });

node.on("upgrade", (req, socket, head) => {
  if (req.url?.startsWith("/api/sync/ws")) {
    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.headers["x-real-ip"] ||
      req.socket?.remoteAddress ||
      "unknown";
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
  syncLimiter.dispose();
  wsLimiter.dispose();
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

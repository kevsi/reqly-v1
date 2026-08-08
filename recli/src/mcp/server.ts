import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { CollectionStore } from "./store.js";
import { listTools, DEFAULT_MAX_BATCH_SIZE, DEFAULT_MAX_CONCURRENCY } from "./tool-definitions.js";
import { createToolHandler } from "./tools.js";
import { setAllowedDirectories } from "./project-analyzer.js";
import { watchBundleFile, type BundleWatcher } from "./watch.js";
import type { ExportBundle, CollectionRunRecord } from "./types.js";

export interface McpServerOptions {
  bundle?: ExportBundle;
  bundlePath?: string;
  env?: string;
  timeout?: number;
  port?: number;
  allowLocalHosts?: boolean;
  maxResponseSize?: number;
  maxBatchSize?: number;
  maxConcurrency?: number;
  corsOrigins?: string[];
  authToken?: string;
  /** Path to server TLS certificate (requires --tls-key). */
  tlsCert?: string;
  /** Path to server TLS private key (requires --tls-cert). */
  tlsKey?: string;
  /** Path to CA certificate for verifying client certs (mTLS). */
  tlsCa?: string;
  allowedDirectories?: string[];
  /** When true, transport returns direct JSON instead of SSE (useful for tests). */
  enableJsonResponse?: boolean;
}

export interface McpServerHandle {
  mcpServer: Server;
  httpServer: http.Server;
  store: CollectionStore;
  close(): void;
}

function logError(message: string): void {
  process.stderr.write(`${message}\n`);
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Hash of cwd used to derive a stable per-project history file under ~/.recli/. */
function cwdHash(): string {
  return crypto.createHash("sha1").update(process.cwd()).digest("hex").slice(0, 8);
}

/** Derive the history file path: prefer bundle-relative, fall back to home dir. */
function deriveHistoryPath(bundlePath?: string): string {
  if (bundlePath) return bundlePath + ".runs.json";
  const dir = path.join(os.homedir(), ".recli");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `history-${cwdHash()}.runs.json`);
}

/** Serialise run history, stripping response bodies to keep file small. */
function serialiseHistory(records: CollectionRunRecord[]): string {
  return JSON.stringify(records, (_key, value) =>
    value instanceof Object && value !== null && "body" in value
      ? { ...value, body: undefined }
      : value,
  );
}

// ── Core builder (private) ───────────────────────────────────────────────

interface CoreResult {
  mcpServer: Server;
  store: CollectionStore;
  bundleWatcher?: BundleWatcher;
  corsOrigins: string[];
}

async function buildMcpCore(options: McpServerOptions): Promise<CoreResult> {
  const store = new CollectionStore();
  let bundle = options.bundle;
  const bundlePath = options.bundlePath;

  if (bundle) store.loadFromBundle(bundle);

  // ── Bundle persistence ──
  let bundleWatcher: BundleWatcher | undefined;
  function persistBundle(): void {
    if (!bundlePath) return;
    const data = store.serializeBundle();
    if (!data) return;
    try {
      const content = JSON.stringify(data, null, 2);
      fs.writeFileSync(bundlePath, content, "utf8");
      bundleWatcher?.markWritten(content);
    } catch (e) {
      logError(`Failed to persist bundle: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  store.setPersistCallback(persistBundle);

  // ── History persistence (always, even without --file) ──
  const historyPath = deriveHistoryPath(bundlePath);
  try {
    if (fs.existsSync(historyPath)) {
      const raw = JSON.parse(fs.readFileSync(historyPath, "utf8")) as unknown;
      store.loadHistory(Array.isArray(raw) ? (raw as CollectionRunRecord[]) : []);
    }
  } catch (e) {
    logError(`Failed to load run history: ${e instanceof Error ? e.message : String(e)}`);
  }
  store.setHistoryPersistCallback(() => {
    try {
      fs.writeFileSync(historyPath, serialiseHistory(store.getRunHistory()), "utf8");
    } catch (e) {
      logError(`Failed to persist run history: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  // ── Hot-reload ──
  bundleWatcher = bundlePath ? watchBundleFile(bundlePath, store, logError) : undefined;

  await setAllowedDirectories(options.allowedDirectories ?? [process.cwd()]);

  const timeoutMs = options.timeout ?? 30000;
  const maxResponseSize = options.maxResponseSize ?? 10 * 1024 * 1024;
  const corsOrigins = options.corsOrigins ?? ["http://127.0.0.1", "http://localhost"];

  const mcpServer = new Server(
    { name: "recli-mcp", version: "0.1.0" },
    { capabilities: { tools: {}, resources: {} } },
  );

  // ── Resource handlers ──
  mcpServer.setRequestHandler(ListResourcesRequestSchema, async () => {
    const collections = store.getCollections();
    const resources: Array<{ uri: string; name: string; description?: string; mimeType: string }> =
      [];
    for (const col of collections) {
      resources.push({
        uri: `reqly://collections/${col.id}`,
        name: `Collection: ${col.name}`,
        description: col.description || `Collection with ${col.requests.length} requests`,
        mimeType: "application/json",
      });
      for (const req of col.requests) {
        resources.push({
          uri: `reqly://requests/${req.id}`,
          name: `${req.method} ${req.name}`,
          description: `${req.method} ${req.url}`,
          mimeType: "application/json",
        });
      }
    }
    return { resources };
  });

  mcpServer.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;
    if (uri.startsWith("reqly://collections/")) {
      const colId = uri.replace("reqly://collections/", "");
      const col = store.getCollection(colId);
      if (!col)
        return {
          contents: [{ uri, mimeType: "text/plain", text: `Collection not found: ${colId}` }],
        };
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(
              {
                id: col.id,
                name: col.name,
                description: col.description,
                color: col.color,
                icon: col.icon,
                request_count: col.requests.length,
                folder_count: col.folders?.length ?? 0,
              },
              null,
              2,
            ),
          },
        ],
      };
    }
    if (uri.startsWith("reqly://requests/")) {
      const reqId = uri.replace("reqly://requests/", "");
      const found = store.findRequestById(reqId);
      if (!found)
        return { contents: [{ uri, mimeType: "text/plain", text: `Request not found: ${reqId}` }] };
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(
              {
                id: found.request.id,
                name: found.request.name,
                method: found.request.method,
                url: found.request.url,
                collection_id: found.collection.id,
                collection_name: found.collection.name,
              },
              null,
              2,
            ),
          },
        ],
      };
    }
    return { contents: [{ uri, mimeType: "text/plain", text: `Unknown resource: ${uri}` }] };
  });

  // ── Tool handlers ──
  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: listTools() }));

  const handleToolCall = createToolHandler(store, bundle, {
    defaultTimeoutMs: timeoutMs,
    defaultEnvName: options.env,
    allowLocalHosts: options.allowLocalHosts,
    maxResponseSize,
    maxBatchSize: options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE,
    maxConcurrency: options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY,
    onProgress: (progressToken, params) => {
      void mcpServer.notification({
        method: "notifications/progress",
        params: { progressToken, ...params },
      });
    },
  });

  mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const progressToken = request.params._meta?.progressToken as string | number | undefined;
    return await handleToolCall(name, (args ?? {}) as Record<string, unknown>, progressToken);
  });

  return { mcpServer, store, bundleWatcher, corsOrigins };
}

// ── HTTP transport builder ───────────────────────────────────────────────

function createHttpServer(
  transport: StreamableHTTPServerTransport,
  corsOrigins: string[],
  authToken?: string,
  tlsOptions?: { cert: string; key: string; ca?: string },
): http.Server {
  const handler = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const origin = req.headers.origin?.toLowerCase() ?? "";
    if (!origin || !corsOrigins.includes(origin)) {
      if (!res.headersSent) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("Origin not allowed");
      }
      return;
    }
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version",
    );
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
    res.setHeader("Vary", "Origin");

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    const pathname = req.url
      ? new URL(req.url, `http://${req.headers.host ?? "localhost"}`).pathname
      : "";
    if (pathname !== "/mcp") {
      if (!res.headersSent) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
      }
      return;
    }

    if (authToken) {
      const header = req.headers.authorization ?? "";
      if (header !== `Bearer ${authToken}`) {
        res.writeHead(401, { "Content-Type": "text/plain", "WWW-Authenticate": "Bearer" });
        res.end("Unauthorized");
        return;
      }
    }

    try {
      await transport.handleRequest(req, res, undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(`MCP error: ${message}`);
      }
    }
  };

  return tlsOptions
    ? https.createServer(
        {
          cert: tlsOptions.cert,
          key: tlsOptions.key,
          ca: tlsOptions.ca,
          requestCert: !!tlsOptions.ca,
        },
        handler as any,
      )
    : http.createServer(handler as any);
}

// ── Public API ───────────────────────────────────────────────────────────

/** Build an MCP server over HTTP transport (for tests or external use). The returned httpServer is NOT listening. */
export async function createMcpHttpServer(options: McpServerOptions): Promise<McpServerHandle> {
  const { mcpServer, store, bundleWatcher, corsOrigins } = await buildMcpCore(options);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    enableJsonResponse: options.enableJsonResponse,
  });
  await mcpServer.connect(transport);

  let tlsOptions: { cert: string; key: string; ca?: string } | undefined;
  if (options.tlsCert && options.tlsKey) {
    tlsOptions = {
      cert: fs.readFileSync(options.tlsCert, "utf8"),
      key: fs.readFileSync(options.tlsKey, "utf8"),
      ca: options.tlsCa ? fs.readFileSync(options.tlsCa, "utf8") : undefined,
    };
  }

  const httpServer = createHttpServer(transport, corsOrigins, options.authToken, tlsOptions);
  const close = () => {
    bundleWatcher?.close();
  };
  return { mcpServer, httpServer, store, close };
}

/** Start the MCP server (stdio or HTTP). This never resolves. */
export async function startMcpServer(options: McpServerOptions): Promise<void> {
  if (options.port && options.port > 0 && options.port < 65536) {
    const { httpServer, close } = await createMcpHttpServer(options);
    httpServer.listen(options.port, "127.0.0.1", () => {
      const proto = options.tlsCert ? "https" : "http";
      logError(`MCP server listening on ${proto}://127.0.0.1:${options.port}/mcp`);
    });
    // Prevent close() from running while the server is alive; keep the handle for GC.
    void close;
  } else {
    const { mcpServer } = await buildMcpCore(options);
    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);
  }
}

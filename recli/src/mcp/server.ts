import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
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
import { listTools } from "./tool-definitions.js";
import { createToolHandler } from "./tools.js";
import type { ExportBundle } from "./types.js";

export interface McpServerOptions {
  bundle?: ExportBundle;
  bundlePath?: string;
  env?: string;
  timeout?: number;
  port?: number;
  allowLocalHosts?: boolean;
  maxResponseSize?: number;
  corsOrigins?: string[];
  /** Directories the project-route analyzer is allowed to read. Defaults to cwd. */
  allowedDirectories?: string[];
}

function logError(message: string): void {
  process.stderr.write(`${message}\n`);
}

export async function startMcpServer(options: McpServerOptions): Promise<void> {
  const store = new CollectionStore();
  let bundle = options.bundle;
  let bundlePath = options.bundlePath;

  if (bundle) {
    store.loadFromBundle(bundle);
  }

  function persistBundle(): void {
    if (!bundlePath) return;
    // ponytail: ensureIds() injects col-/req-/env- ids into the in-memory copy
    // on load, so the first mutation rewrites the user's source file WITH those
    // generated ids. Intended persistence, but a human editing demo.json
    // afterwards will see ids appear — known ceiling until bundles ship ids by
    // default.
    const data = store.serializeBundle();
    if (!data) return;
    try {
      fs.writeFileSync(bundlePath, JSON.stringify(data, null, 2), "utf8");
    } catch (e) {
      logError(`Failed to persist bundle: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  store.setPersistCallback(persistBundle);

  const timeoutMs = options.timeout ?? 30000;
  const maxResponseSize = options.maxResponseSize ?? 10 * 1024 * 1024;
  const corsOrigins = options.corsOrigins ?? ["http://127.0.0.1", "http://localhost"];

  const server = new Server(
    { name: "recli-mcp", version: "0.1.0" },
    { capabilities: { tools: {}, resources: {} } },
  );

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
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

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;
    if (uri.startsWith("reqly://collections/")) {
      const colId = uri.replace("reqly://collections/", "");
      const col = store.getCollection(colId);
      if (!col) {
        return {
          contents: [{ uri, mimeType: "text/plain", text: `Collection not found: ${colId}` }],
        };
      }
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
      if (!found) {
        return { contents: [{ uri, mimeType: "text/plain", text: `Request not found: ${reqId}` }] };
      }
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

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: listTools() }));

  const handleToolCall = createToolHandler(store, bundle, {
    defaultTimeoutMs: timeoutMs,
    defaultEnvName: options.env,
    allowLocalHosts: options.allowLocalHosts,
    maxResponseSize,
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return await handleToolCall(name, (args ?? {}) as Record<string, unknown>);
  });

  if (options.port && options.port > 0 && options.port < 65536) {
    await startHTTPTransport(server, options.port, corsOrigins);
  } else {
    await startStdioTransport(server);
  }
}

function startStdioTransport(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    const transport = new StdioServerTransport();
    server.connect(transport).catch(reject);
  });
}

async function startHTTPTransport(
  server: Server,
  port: number,
  corsOrigins: string[],
): Promise<void> {
  const mcpTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  });
  await server.connect(mcpTransport);

  const httpServer = http.createServer(async (req, res) => {
    // SECURITY: Reject requests with no Origin or with an Origin not in the
    // allowlist.  CORS headers are only a browser-enforced mechanism; without
    // this check any local process (curl, scripts, etc.) could call MCP tools
    // by simply omitting the Origin header.
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
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
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

    try {
      await mcpTransport.handleRequest(req, res, undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(`MCP error: ${message}`);
      }
    }
  });

  httpServer.listen(port, "127.0.0.1", () => {
    logError(`MCP server listening on http://127.0.0.1:${port}/mcp`);
  });
}

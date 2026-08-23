/**
 * Bruno collection import parser for Reqly.
 * Supports:
 *   - Single `.bru` files (Bruno's native DSL format)
 *   - Bruno JSON bundle format (bruno.json with bundled requests)
 *
 * Bruno stores collections as directories of .bru files. This parser
 * handles the common patterns found in exported Bruno collections.
 */

import type { CollectionImportData } from "@/lib/openapi-import";

// ─── Public types ───────────────────────────────────────────────────────────

export interface BrunoParseError {
  success: false;
  error: string;
}

export interface BrunoParseSuccess {
  success: true;
  collectionName: string;
  endpoints: {
    method: string;
    url: string;
    name: string;
    headers?: Record<string, string>;
    body?: string;
    bodyType?: "json" | "form-data" | "x-www-form" | "raw" | "binary";
  }[];
}

export type BrunoParseResult = BrunoParseError | BrunoParseSuccess;

// ─── Main parser ────────────────────────────────────────────────────────────

/**
 * Parse a Bruno collection from either:
 * - A `.bru` file content (single request)
 * - A Bruno JSON bundle (bruno.json with embedded requests)
 * - A JSON file containing an array of .bru-style objects
 */
/** Taille maximale acceptée pour une collection Bruno importée (anti-DoS). */
export const MAX_BRUNO_IMPORT_BYTES = 10 * 1024 * 1024; // 10 Mo

export function parseBrunoCollection(contents: string, fileName?: string): BrunoParseResult {
  if (new TextEncoder().encode(contents).length > MAX_BRUNO_IMPORT_BYTES) {
    return {
      success: false,
      error: `Fichier trop volumineux (max ${MAX_BRUNO_IMPORT_BYTES / (1024 * 1024)} Mo)`,
    };
  }
  try {
    // Try JSON first (Bruno bundle format)
    const parsed = tryParseJson(contents);
    if (parsed) {
      return parseBrunoJson(parsed, fileName);
    }

    // Fallback: try as .bru DSL text format
    return parseBruFile(contents);
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Erreur inconnue lors du parsing.",
    };
  }
}

/**
 * Convert a Bruno parse result to Reqly CollectionImportData[]
 */
export function convertBrunoToCollections(result: BrunoParseSuccess): CollectionImportData[] {
  return [
    {
      name: result.collectionName,
      color: "emerald",
      icon: "package",
      requests: result.endpoints.map((ep) => ({
        name: ep.name,
        method: ep.method,
        url: ep.url,
        endpoint: extractPath(ep.url),
        headers: ep.headers,
        body: ep.body ?? "",
        bodyType: ep.bodyType,
      })),
    },
  ];
}

// ─── Internal: .bru DSL parser ──────────────────────────────────────────────

/**
 * Parse a single .bru file content into a request endpoint.
 *
 * .bru format example:
 * ```
 * meta {
 *   name: Get Users
 *   type: http
 * }
 *
 * get {
 *   url: https://api.example.com/users
 *   body: json
 *   auth: none
 * }
 *
 * headers {
 *   accept: application/json
 *   authorization: Bearer {{token}}
 * }
 *
 * body:json {
 *   { "key": "value" }
 * }
 * ```
 */
function parseBruFile(content: string): BrunoParseResult {
  // Validate that content looks like a .bru file
  if (!content.includes("{") || !content.includes("}")) {
    return {
      success: false,
      error: "Format .bru non reconnu. Le fichier doit contenir des blocs structurés.",
    };
  }

  const name = extractBruValue(content, "name") || "Import Bruno";

  // Detect HTTP method and URL
  const method = detectBruMethod(content);
  const url = extractBruUrl(content, method);

  // Extract headers
  const headers = extractBruHeaders(content);

  // Extract body
  const body = extractBruBody(content);

  if (!method && !url && Object.keys(headers).length === 0 && !body.data) {
    return {
      success: false,
      error: "Impossible de trouver une requête valide dans ce fichier .bru.",
    };
  }

  return {
    success: true,
    collectionName: name,
    endpoints: [
      {
        name,
        method: method || "GET",
        url: url || "/",
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        body: body.data,
        bodyType: body.type,
      },
    ],
  };
}

function extractBruValue(content: string, key: string): string | null {
  // Match `key: value` on any line (inside blocks)
  const regex = new RegExp(`^\\s*${key}:\\s*(.+)$`, "m");
  const match = content.match(regex);
  return match ? match[1].trim() : null;
}

function detectBruMethod(content: string): string | null {
  const methods = ["get", "post", "put", "patch", "delete", "options", "head"];
  for (const m of methods) {
    const regex = new RegExp(`^${m}\\s*\\{`, "m");
    if (regex.test(content)) return m.toUpperCase();
  }
  return null;
}

/**
 * Extract the URL from a .bru file.
 * Uses line-by-line parsing to handle Bruno variables like {{baseUrl}}.
 */
function extractBruUrl(content: string, method: string | null): string | null {
  const methodLower = (method || "get").toLowerCase();
  const lines = content.split("\n");
  let inBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === `${methodLower} {` || trimmed.startsWith(`${methodLower} {`)) {
      inBlock = true;
      continue;
    }
    if (inBlock && trimmed === "}") {
      inBlock = false;
      continue;
    }
    if (inBlock && trimmed.startsWith("url:")) {
      return trimmed.slice(4).trim();
    }
  }
  return null;
}

/**
 * Extract headers from a .bru file.
 * Uses line-by-line parsing to handle Bruno variables like {{token}}.
 */
function extractBruHeaders(content: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const lines = content.split("\n");
  let inBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "headers {" || trimmed.startsWith("headers {")) {
      inBlock = true;
      continue;
    }
    if (inBlock && trimmed === "}") {
      inBlock = false;
      continue;
    }
    if (inBlock && trimmed.includes(":")) {
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx > 0) {
        const key = trimmed.slice(0, colonIdx).trim();
        const value = trimmed.slice(colonIdx + 1).trim();
        if (key) headers[key] = value;
      }
    }
  }
  return headers;
}

function extractBruBody(content: string): {
  data?: string;
  type?: "json" | "form-data" | "x-www-form" | "raw" | "binary";
} {
  const lines = content.split("\n");
  let inBlock: string | null = null;
  const bodyLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect body block start
    const bodyMatch = trimmed.match(/^body:(json|text|multipart-form|form-urlencoded)\s*\{$/i);
    if (bodyMatch) {
      inBlock = bodyMatch[1].toLowerCase();
      continue;
    }

    // Detect closing brace
    if (inBlock && trimmed === "}") {
      const data = bodyLines.join("\n").trim();
      const typeMap: Record<string, "json" | "form-data" | "x-www-form" | "raw" | "binary"> = {
        json: "json",
        text: "raw",
        "multipart-form": "form-data",
        "form-urlencoded": "x-www-form",
      };
      return {
        data: data || undefined,
        type: typeMap[inBlock] || "raw",
      };
    }

    // Collect body lines
    if (inBlock) {
      bodyLines.push(line);
    }
  }

  return {};
}

// ─── Internal: Bruno JSON bundle parser ─────────────────────────────────────

function parseBrunoJson(parsed: unknown, fileName?: string): BrunoParseResult {
  const doc = parsed as Record<string, unknown>;
  const name =
    (doc.name as string) ||
    (doc.collectionName as string) ||
    (doc.collection as string) ||
    fileName ||
    "Bruno Import";

  // Check if it's a bruno.json with items/requests
  const items =
    (doc.items as unknown[]) || (doc.requests as unknown[]) || (doc.endpoints as unknown[]) || [];

  const endpoints: BrunoParseSuccess["endpoints"] = [];

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;

    // Handle standard formats
    if (obj.method && (obj.url || obj.path)) {
      endpoints.push(buildEndpoint(obj));
      continue;
    }

    // Handle { request: { method, url, ... } } wrapper
    if (obj.request && typeof obj.request === "object") {
      const req = obj.request as Record<string, unknown>;
      endpoints.push({
        name: (obj.name as string) || (req.name as string) || `${req.method} ${req.url}`,
        method: ((req.method as string) || "GET").toUpperCase(),
        url: (req.url as string) || "",
        headers: extractJsonHeaders(req.headers),
        body: extractJsonBody(req.body),
        bodyType: extractJsonBodyType(req.body),
      });
      continue;
    }
  }

  return {
    success: true,
    collectionName: name as string,
    endpoints,
  };
}

function buildEndpoint(obj: Record<string, unknown>): BrunoParseSuccess["endpoints"][number] {
  const method = ((obj.method as string) || "GET").toUpperCase();
  const url = (obj.url as string) || (obj.path as string) || "/";
  const name = (obj.name as string) || (obj.summary as string) || `${method} ${url}`;

  return {
    name,
    method,
    url,
    headers: extractJsonHeaders(obj.headers),
    body: extractJsonBody(obj.body),
    bodyType: extractJsonBodyType(obj.body),
  };
}

function extractJsonHeaders(headers: unknown): Record<string, string> | undefined {
  if (!headers) return undefined;
  if (typeof headers === "object" && !Array.isArray(headers)) {
    return headers as Record<string, string>;
  }
  if (Array.isArray(headers)) {
    const result: Record<string, string> = {};
    for (const h of headers) {
      if (h && typeof h === "object") {
        const hObj = h as Record<string, unknown>;
        const key = (hObj.key as string) || (hObj.name as string) || "";
        const value = (hObj.value as string) || "";
        if (key) result[key] = value;
      }
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }
  return undefined;
}

function extractJsonBody(body: unknown): string | undefined {
  if (!body) return undefined;
  if (typeof body === "string") return body;
  if (typeof body === "object") {
    // Try { data, text, content } fields
    const b = body as Record<string, unknown>;
    if (b.data && typeof b.data === "string") return b.data;
    if (b.text && typeof b.text === "string") return b.text;
    if (b.content && typeof b.content === "string") return b.content;
    if (b.raw && typeof b.raw === "string") return b.raw;
    // If body is an inline JSON object, stringify it
    return JSON.stringify(body, null, 2);
  }
  return undefined;
}

function extractJsonBodyType(
  body: unknown,
): "json" | "form-data" | "x-www-form" | "raw" | "binary" | undefined {
  if (!body) return undefined;
  if (typeof body === "string") {
    try {
      JSON.parse(body);
      return "json";
    } catch {
      return "raw";
    }
  }
  if (typeof body === "object") {
    const b = body as Record<string, unknown>;
    const mode = (b.mode as string) || "";
    const type = (b.type as string) || "json";
    if (mode === "form" || type === "form") return "form-data";
    if (mode === "urlencoded" || type === "urlencoded") return "x-www-form";
    if (mode === "binary" || type === "binary") return "binary";
    // Object body is typically JSON
    return "json";
  }
  return undefined;
}

// ─── Shared helpers ─────────────────────────────────────────────────────────

function tryParseJson(contents: string): unknown | null {
  try {
    return JSON.parse(contents);
  } catch {
    return null;
  }
}

function extractPath(url: string): string {
  try {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      return new URL(url).pathname;
    }
  } catch {
    // ignore
  }
  return url || "/";
}

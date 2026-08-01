/**
 * Phase 6.6 — Explain helpers (JWT, headers, JSON)
 *
 * Pure functions for the "Explain" mode (F4): decode JWTs, explain HTTP
 * headers, and produce annotated JSON summaries.
 */

export interface DecodedJwt {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signature: string;
  /** True if exp is in the past. */
  expired: boolean;
  /** Expiration as ISO string, or null if absent. */
  expiresAt: string | null;
}

/** Base64url decode → Uint8Array. */
function base64UrlDecode(input: string): Uint8Array {
  // Convert base64url → base64 (replace chars, add padding)
  let s = input.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4 !== 0) s += "=";
  const bin = typeof atob !== "undefined" ? atob(s) : Buffer.from(s, "base64").toString("binary");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Decode a JWT (without verifying signature).
 * Returns null if the token is malformed.
 */
export function decodeJwt(token: string): DecodedJwt | null {
  if (typeof token !== "string") return null;
  const parts = token.trim().split(".");
  if (parts.length !== 3) return null;

  try {
    const headerJson = new TextDecoder().decode(base64UrlDecode(parts[0]));
    const payloadJson = new TextDecoder().decode(base64UrlDecode(parts[1]));
    const header = JSON.parse(headerJson);
    const payload = JSON.parse(payloadJson);

    let expired = false;
    let expiresAt: string | null = null;
    if (typeof payload.exp === "number") {
      expired = payload.exp * 1000 < Date.now();
      expiresAt = new Date(payload.exp * 1000).toISOString();
    } else if (typeof payload.exp === "string") {
      const ts = Date.parse(payload.exp);
      if (!Number.isNaN(ts)) {
        expired = ts < Date.now();
        expiresAt = new Date(ts).toISOString();
      }
    }

    return { header, payload, signature: parts[2], expired, expiresAt };
  } catch {
    return null;
  }
}

/** Description + warnings for a known HTTP header. */
export interface HeaderExplanation {
  description: string;
  warnings: string[];
}

const KNOWN_HEADERS: Record<string, string> = {
  authorization: "Credentials for authenticating the request (Bearer, Basic, etc.).",
  "content-type": "MIME type of the request/response body.",
  accept: "MIME types the client can process, used for content negotiation.",
  "accept-encoding": "Compression algorithms the client supports (gzip, br, deflate).",
  "accept-language": "Preferred natural languages for the response.",
  "user-agent": "Identifies the client software making the request.",
  cookie: "HTTP cookies previously set by the server.",
  "cache-control": "Caching directives (no-store, max-age, etc.).",
  "x-api-key": "API key for the request (provider-specific).",
  "x-csrf-token": "Token to prevent cross-site request forgery.",
  "x-request-id": "Unique identifier for tracing the request across services.",
  authorization2: "Alternative form of Authorization (avoid in practice).",
  referer: "URL of the page making the request.",
  origin: "Origin of the request (for CORS).",
  "if-none-match": "ETag for conditional requests (304 Not Modified).",
  "if-modified-since": "Date for conditional requests.",
  range: "Range of bytes to retrieve (used for resumable downloads).",
  authorization3: "JWT-specific: sends a JWT in the Authorization header.",
  accept_charset: "Character sets the client supports (legacy).",
};

/**
 * Explain an HTTP header. Returns a description and any warnings about
 * suspicious values.
 */
export function explainHeader(name: string, value: string): HeaderExplanation {
  const key = name.toLowerCase().trim();
  const warnings: string[] = [];
  let description = KNOWN_HEADERS[key] ?? "Custom HTTP header.";

  // Heuristics / warnings
  if (key === "authorization") {
    if (/^Bearer\s+\S+$/i.test(value)) {
      // Try to decode a JWT
      const token = value.replace(/^Bearer\s+/i, "").trim();
      const jwt = decodeJwt(token);
      if (jwt) {
        const exp = jwt.expiresAt ? (jwt.expired ? ` ⚠️ expiré le ${jwt.expiresAt}` : ` expire le ${jwt.expiresAt}`) : "";
        description = `Token Bearer (JWT${exp}).`;
      } else {
        description = `Token Bearer (opaque).`;
      }
    } else if (/^Basic\s+/i.test(value)) {
      const decoded = (() => {
        try {
          return atob(value.replace(/^Basic\s+/i, "").trim());
        } catch {
          return null;
        }
      })();
      description = decoded
        ? `Basic auth (user:pass encodés en base64) — "${decoded}".`
        : "Basic auth (credentials base64-encoded).";
    } else if (/^Token\s+/i.test(value)) {
      description = "Token-based authentication.";
    } else {
      warnings.push("Schéma d'autorisation non standard. Vérifie le format.");
    }
  }

  if (key === "content-type") {
    if (!/^[a-z]+\/[a-z0-9.+-]+/i.test(value)) {
      warnings.push("Content-Type ne ressemble pas à un MIME type standard.");
    }
  }

  if (key === "cookie" && value.length > 4096) {
    warnings.push("Cookie > 4 Ko : risque de troncature par certains serveurs.");
  }

  if (key.startsWith("x-") && !KNOWN_HEADERS[key]) {
    warnings.push("Header préfixé X- : convention dépréciée, préférer un nom de domaine explicite.");
  }

  return { description, warnings };
}

export interface AnnotatedJsonNode {
  type: "string" | "number" | "boolean" | "null" | "array" | "object";
  value?: unknown;
  children?: Record<string, AnnotatedJsonNode>;
  items?: AnnotatedJsonNode[];
  length?: number;
}

/**
 * Build an annotated JSON tree with type info. Useful for rendering
 * a structured explanation of a response body.
 */
export function annotateJson(value: unknown): AnnotatedJsonNode {
  if (value === null) return { type: "null", value: null };
  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
      items: value.map((v) => annotateJson(v)),
    };
  }
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") {
    return { type: t as "string" | "number" | "boolean", value };
  }
  if (t === "object") {
    const obj = value as Record<string, unknown>;
    const children: Record<string, AnnotatedJsonNode> = {};
    for (const [k, v] of Object.entries(obj)) {
      children[k] = annotateJson(v);
    }
    return { type: "object", children };
  }
  return { type: "null", value: null };
}

/** Render an annotated tree as a one-line summary, e.g. "object{string,number}". */
export function summarizeAnnotated(node: AnnotatedJsonNode): string {
  switch (node.type) {
    case "object": {
      const keys = Object.keys(node.children ?? {});
      const inner = keys.map((k) => `${k}:${summarizeAnnotated(node.children![k])}`).join(",");
      const suffix = keys.length > 0 ? `{${inner}}` : "{}";
      return `object${suffix}`;
    }
    case "array":
      return `array(${node.length ?? 0})`;
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
    default:
      return "null";
  }
}

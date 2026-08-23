/**
 * Capture middleware for proxy requests
 * Integrates HTTP capture with existing proxy endpoint
 */

import {
  CapturedRequest,
  CapturedResponse,
  recordSession,
  getProxyState,
} from "@/lib/capture-proxy";
import { randomUUID } from "crypto";

/**
 * En-têtes sensibles dont la valeur est masquée avant stockage/export
 * (miroir de la liste desktop dans capture.rs, complétée).
 */
const SENSITIVE_HEADERS = [
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "api-key",
  "x-auth-token",
  "x-access-token",
  "x-refresh-token",
  "x-session-token",
  "x-csrf-token",
  "credentials",
];

/** `true` si le nom d'en-tête contient un mot-clé sensible. */
function isSensitiveHeader(name: string): boolean {
  const lower = name.toLowerCase();
  if (SENSITIVE_HEADERS.includes(lower)) return true;
  return (
    lower.includes("authorization") ||
    lower.includes("auth-token") ||
    lower.includes("access-token") ||
    lower.includes("refresh-token") ||
    lower.includes("session-token") ||
    lower.includes("secret") ||
    lower.includes("password") ||
    lower.endsWith("-key") ||
    lower.includes("private-key")
  );
}

/** Masque les valeurs des en-têtes sensibles (« [REDACTED] »). */
export function redactSensitiveHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = isSensitiveHeader(key) ? "[REDACTED]" : value;
  }
  return out;
}

export async function captureRequest(
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: string | null,
): Promise<CapturedRequest> {
  return {
    id: randomUUID(),
    timestamp: Date.now(),
    method,
    url,
    headers: redactSensitiveHeaders(headers),
    body: body || undefined,
  };
}

export async function captureResponse(
  statusCode: number,
  headers: Record<string, string>,
  body: string,
): Promise<CapturedResponse> {
  return {
    statusCode,
    statusMessage: getStatusMessage(statusCode),
    headers: redactSensitiveHeaders(headers),
    body,
  };
}

export async function recordCapturedRequest(
  request: CapturedRequest,
  response: CapturedResponse,
  duration: number,
  rateLimitKey?: string,
  userId?: string,
) {
  const state = getProxyState();
  if (!state.isRunning) {
    return null; // Capture not active
  }

  try {
    return await recordSession(request, response, duration, rateLimitKey, userId);
  } catch (error) {
    console.error("[Capture Middleware] Error recording session:", error);
    return null;
  }
}

function getStatusMessage(code: number): string {
  const messages: Record<number, string> = {
    200: "OK",
    201: "Created",
    204: "No Content",
    300: "Multiple Choices",
    301: "Moved Permanently",
    302: "Found",
    304: "Not Modified",
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    405: "Method Not Allowed",
    408: "Request Timeout",
    429: "Too Many Requests",
    500: "Internal Server Error",
    502: "Bad Gateway",
    503: "Service Unavailable",
    504: "Gateway Timeout",
  };

  return messages[code] || "Unknown";
}

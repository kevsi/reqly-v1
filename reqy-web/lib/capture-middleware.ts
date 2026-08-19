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
    headers,
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
    headers,
    body,
  };
}

export async function recordCapturedRequest(
  request: CapturedRequest,
  response: CapturedResponse,
  duration: number,
  rateLimitKey?: string,
) {
  const state = getProxyState();
  if (!state.isRunning) {
    return null; // Capture not active
  }

  try {
    return await recordSession(request, response, duration, rateLimitKey);
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

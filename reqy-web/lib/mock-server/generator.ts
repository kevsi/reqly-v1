import type { CapturedRequest } from "@/lib/tauri";
import type { MockEndpoint } from "./types";

export function generateMockFromCapture(capture: CapturedRequest): MockEndpoint {
  return {
    id: `mock-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name: `${capture.method} ${capture.url}`,
    method: capture.method,
    path: new URL(capture.url).pathname,
    statusCode: capture.responseStatus || 200,
    headers: capture.responseHeaders || {},
    body: capture.responseBody || "",
    enabled: true,
    createdAt: new Date().toISOString(),
    source: "capture",
  };
}

export function generateMockFromHistory(historyItem: {
  method: string;
  url: string;
  responseStatus?: number;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
}): MockEndpoint {
  const url = new URL(historyItem.url);
  return {
    id: `mock-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name: `${historyItem.method} ${url.pathname}`,
    method: historyItem.method,
    path: url.pathname,
    statusCode: historyItem.responseStatus || 200,
    headers: historyItem.responseHeaders || { "Content-Type": "application/json" },
    body: historyItem.responseBody || "",
    enabled: true,
    createdAt: new Date().toISOString(),
    source: "capture",
  };
}

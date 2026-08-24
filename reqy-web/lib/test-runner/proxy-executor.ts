"use client";

/**
 * Executor HTTP du test-runner passant par le proxy SSRF-guard existant
 * (`/api/proxy`). Partagé par les monitors et l'outil IA run_collection.
 */
import type { RequestResponse } from "./types";

export function createProxyExecutor(timeoutMs = 30_000) {
  return async (req: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: unknown;
  }): Promise<RequestResponse> => {
    const started = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const proxyRes = await fetch("/api/proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: req.url,
          method: req.method,
          headers: req.headers,
          body: req.body,
        }),
        signal: controller.signal,
      });
      const proxyResult = await proxyRes.json();
      const text = proxyResult.body ?? "";
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
      return {
        statusCode: proxyResult.status ?? proxyRes.status,
        responseTimeMs: Date.now() - started,
        body: parsed,
        headers: proxyResult.headers || {},
      };
    } finally {
      clearTimeout(timeout);
    }
  };
}

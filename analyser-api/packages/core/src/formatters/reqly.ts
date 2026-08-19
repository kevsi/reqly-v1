import type { AnalysisResult } from "../types.ts";

/**
 * Maps an AnalysisResult to the Reqly RequestCollection shape.
 * ponytail: best-effort mapping, aligned with the Reqly model from the spec;
 * re-tune the exact field names when the Reqly app is actually connected.
 */
export interface ReqlyRequest {
  id: string;
  name: string;
  method: string;
  url: string;
  auth?: { type: string; required: boolean };
  headers?: Record<string, string>;
  body?: { contentType: string; raw?: string };
}

export interface ReqlyExport {
  name: string;
  requests: ReqlyRequest[];
}

export function toReqly(result: AnalysisResult): ReqlyExport {
  const requests: ReqlyRequest[] = result.routes.map((r, i) => ({
    id: `req_${i}`,
    name: `${r.method} ${r.path || "/"}`,
    method: r.method === "ALL" ? "GET" : r.method,
    url: `{{baseUrl}}${r.path || "/"}`,
    auth: r.auth.required
      ? { type: r.auth.middleware?.join("+") ?? "token", required: true }
      : undefined,
    body:
      r.body && r.body.contentType
        ? { contentType: r.body.contentType, raw: r.body.raw }
        : undefined,
  }));
  return {
    name: result.projectName,
    requests,
  };
}

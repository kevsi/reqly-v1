import type { GraphQLError, GraphQLExecuteResult, GraphQLRequest } from "./types";
import { proxyAuthHeaders } from "@/lib/proxy-auth";

interface ProxySuccessResponse {
  status: number;
  body: string;
  headers: Record<string, string>;
  durationMs: number;
}

interface ProxyErrorResponse {
  error?: string;
  status?: number;
  headers?: Record<string, string>;
}

type ProxyResponse = ProxySuccessResponse | ProxyErrorResponse;

function isProxyError(res: Response, data: ProxyResponse): data is ProxyErrorResponse {
  return !res.ok || "error" in data;
}

export async function executeGraphQL(input: GraphQLRequest): Promise<GraphQLExecuteResult> {
  const started = Date.now();

  const proxyRes = await fetch("/api/proxy", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...proxyAuthHeaders(),
    },
    body: JSON.stringify({
      url: input.endpoint,
      method: "POST",
      headers: {
        ...(input.headers ?? {}),
      },
      body: JSON.stringify({
        query: input.query,
        variables: input.variables ?? {},
        operationName: input.operationName,
      }),
    }),
  });

  const proxyData: ProxyResponse = await proxyRes
    .json()
    .catch(() => ({ error: "Invalid proxy response" }));

  if (isProxyError(proxyRes, proxyData)) {
    return {
      statusCode: proxyData.status ?? proxyRes.status,
      responseTimeMs: Date.now() - started,
      headers: proxyData.headers ?? {},
      graphqlBody: {},
      errors: [{ message: proxyData.error ?? `Proxy request failed (HTTP ${proxyRes.status})` }],
    };
  }

  const responseTimeMs = proxyData.durationMs ?? Date.now() - started;

  let graphqlJson: Record<string, unknown> = {};
  try {
    graphqlJson = JSON.parse(proxyData.body);
  } catch {
    /* body is not JSON */
  }

  return {
    statusCode: proxyData.status,
    responseTimeMs,
    headers: proxyData.headers ?? {},
    graphqlBody: graphqlJson,
    data:
      graphqlJson && typeof graphqlJson === "object" && "data" in graphqlJson
        ? (graphqlJson as { data: unknown }).data
        : graphqlJson,
    errors:
      graphqlJson && typeof graphqlJson === "object" && "errors" in graphqlJson
        ? (graphqlJson as { errors: GraphQLError[] }).errors
        : undefined,
  };
}

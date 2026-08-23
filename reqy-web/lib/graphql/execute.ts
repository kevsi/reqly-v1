import type { GraphQLError, GraphQLExecuteResult, GraphQLRequest } from "./types";
import { proxyAuthHeaders } from "@/lib/proxy-auth";
import { friendlyGraphQLError } from "./errors";

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
    const raw = proxyData.error ?? `Proxy request failed (HTTP ${proxyRes.status})`;
    return {
      statusCode: proxyData.status ?? proxyRes.status,
      responseTimeMs: Date.now() - started,
      headers: proxyData.headers ?? {},
      graphqlBody: {},
      errors: [{ message: friendlyGraphQLError(proxyData.status ?? proxyRes.status, raw) }],
    };
  }

  const responseTimeMs = proxyData.durationMs ?? Date.now() - started;

  let graphqlJson: Record<string, unknown> | null = null;
  try {
    graphqlJson = JSON.parse(proxyData.body);
  } catch {
    /* body is not JSON */
  }

  if (!graphqlJson || typeof graphqlJson !== "object") {
    const preview = (proxyData.body ?? "").slice(0, 300);
    return {
      statusCode: proxyData.status,
      responseTimeMs,
      headers: proxyData.headers ?? {},
      graphqlBody: {},
      errors: [
        {
          message: `L'endpoint n'a pas répondu en JSON — vérifiez que l'URL pointe bien vers une API GraphQL. Réponse : ${
            preview || "(vide)"
          }`,
        },
      ],
    };
  }

  return {
    statusCode: proxyData.status,
    responseTimeMs,
    headers: proxyData.headers ?? {},
    graphqlBody: graphqlJson,
    data: "data" in graphqlJson ? (graphqlJson as { data: unknown }).data : graphqlJson,
    errors:
      "errors" in graphqlJson ? (graphqlJson as { errors: GraphQLError[] }).errors : undefined,
  };
}

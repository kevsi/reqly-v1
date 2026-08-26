import type { AnalysisResult, ApiRoute, HttpMethod } from "../types.ts";

function toOpenApiPath(p: string): string {
  return p
    .replace(/\[([A-Za-z_]\w*)\]/g, "{$1}")
    .replace(/:([A-Za-z_]\w*)/g, "{$1}")
    .replace(/<[A-Za-z]*:([A-Za-z_]\w*)>/g, "{$1}");
}

/** Name of the single security scheme declared for heuristically detected auth. */
export const AUTH_SCHEME_NAME = "auth";

function opFromRoute(r: ApiRoute): Record<string, unknown> {
  const parameters: Record<string, unknown>[] = [
    ...(r.params ?? []).map((name) => ({
      name,
      in: "path",
      required: true,
      schema: { type: "string" },
    })),
    ...(r.query ?? []).map((name) => ({
      name,
      in: "query",
      required: false,
      schema: { type: "string" },
    })),
  ];
  const op: Record<string, unknown> = {
    summary: `${r.method} ${r.path}`,
    parameters,
  };
  if (r.auth.required) op.security = [{ [AUTH_SCHEME_NAME]: [] }];
  if (r.body) {
    const contentType = r.body.contentType ?? "application/json";
    const schema = r.body.schemaName
      ? { schema: { type: "object", title: r.body.schemaName } }
      : { schema: { type: "object" } };
    op.requestBody = { content: { [contentType]: schema } };
  }
  return op;
}

/** Maps an AnalysisResult to an OpenAPI 3.0 document.
 * Note: method ALL is mapped to GET (OpenAPI has no wildcard); the source
 * method is preserved in `route.method` for consumers that need it. */
export function toOpenApi(result: AnalysisResult): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  let hasAuth = false;
  for (const r of result.routes) {
    if (r.auth.required) hasAuth = true;
    const p = toOpenApiPath(r.path) || "/";
    // ALL (e.g. Django path, Go Any) has no OpenAPI equivalent — map to GET.
    const method = (r.method === "ALL" ? "GET" : r.method.toLowerCase()) as Lowercase<HttpMethod>;
    (paths[p] ??= {})[method] = opFromRoute(r);
  }
  return {
    openapi: "3.0.3",
    info: { title: result.projectName, version: "0.1.0" },
    paths,
    ...(hasAuth
      ? {
          components: {
            securitySchemes: {
              [AUTH_SCHEME_NAME]: {
                type: "http",
                scheme: "bearer",
                description:
                  "Authentication detected by naming heuristics (middleware/guard); adjust the scheme to match the backend.",
              },
            },
          },
        }
      : {}),
  };
}

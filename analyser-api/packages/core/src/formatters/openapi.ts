import type { AnalysisResult, ApiRoute, HttpMethod } from "../types.ts";

function toOpenApiPath(p: string): string {
  return p
    .replace(/\[([A-Za-z_]\w*)\]/g, "{$1}")
    .replace(/:([A-Za-z_]\w*)/g, "{$1}")
    .replace(/<[A-Za-z]*:([A-Za-z_]\w*)>/g, "{$1}");
}

function opFromRoute(r: ApiRoute): Record<string, unknown> {
  const op: Record<string, unknown> = {
    summary: `${r.method} ${r.path}`,
    parameters: (r.params ?? []).map((name) => ({
      name,
      in: "path",
      required: true,
      schema: { type: "string" },
    })),
  };
  if (r.auth.required) op.security = [{ auth: [] }];
  if (r.body) {
    const contentType = r.body.contentType ?? "application/json";
    const schema = r.body.schemaName
      ? { schema: { type: "object", title: r.body.schemaName } }
      : { schema: { type: "object" } };
    op.requestBody = { content: { [contentType]: schema } };
  }
  return op;
}

/** Maps an AnalysisResult to an OpenAPI 3.0 document. */
export function toOpenApi(result: AnalysisResult): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of result.routes) {
    const p = toOpenApiPath(r.path) || "/";
    const method = (r.method === "ALL" ? "GET" : r.method.toLowerCase()) as Lowercase<HttpMethod>;
    (paths[p] ??= {})[method] = opFromRoute(r);
  }
  return {
    openapi: "3.0.3",
    info: { title: result.projectName, version: "0.1.0" },
    paths,
  };
}

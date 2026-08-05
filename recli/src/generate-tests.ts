import { parseSpec } from "./contract.js";
import type { OAS3Doc, OAS3Operation } from "./contract.js";
import type { RequestItem, ExportBundle } from "./types.js";

function pick<V>(arr: V[]): V | undefined {
  return arr[Math.floor(Math.random() * arr.length)] ?? arr[0];
}

function exampleForParam(p: NonNullable<OAS3Operation["parameters"]>[number]): string {
  if (p.example !== undefined) return String(p.example);
  if (p.schema?.default !== undefined) return String(p.schema.default);
  if (p.schema?.enum) return String(pick(p.schema.enum));
  if (p.schema?.type === "integer" || p.schema?.type === "number") return "1";
  return "";
}

function wrongTypeValue(type?: string): unknown {
  if (type === "string") return 123;
  if (type === "integer" || type === "number") return "not-a-number";
  if (type === "boolean") return "not-a-boolean";
  return undefined;
}

function buildExampleBody(schema: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (schema.type !== "object" || !schema.properties) return result;
  for (const [key, prop] of Object.entries(schema.properties as Record<string, unknown>)) {
    const p = prop as Record<string, unknown>;
    if (p.example !== undefined) {
      result[key] = p.example;
      continue;
    }
    if (p.type === "object" && p.properties) {
      result[key] = buildExampleBody(p);
      continue;
    }
    if (p.type === "array" && p.items) {
      result[key] = [buildExampleBody(p.items as Record<string, unknown>)];
      continue;
    }
    if (p.type === "string") {
      if (p.enum) {
        result[key] = pick(p.enum as unknown[]);
        continue;
      }
      if (p.format === "email") {
        result[key] = "user@example.com";
        continue;
      }
      if (p.format === "uri") {
        result[key] = "https://example.com";
        continue;
      }
      if (p.format === "uuid") {
        result[key] = "550e8400-e29b-41d4-a716-446655440000";
        continue;
      }
      result[key] = "string";
    } else if (p.type === "integer" || p.type === "number") {
      result[key] = 0;
    } else if (p.type === "boolean") {
      result[key] = false;
    }
  }
  return result;
}

function inferAuth(doc: OAS3Doc, op: OAS3Operation): string | undefined {
  const opSec = op.security;
  const key = opSec ? Object.keys(opSec[0] ?? {})[0] : undefined;
  if (!key) return undefined;
  const s = doc.components?.securitySchemes?.[key];
  if (!s) return undefined;
  if (s.type === "http" && s.scheme === "bearer") return "bearer";
  if (s.type === "apiKey") return "api-key";
  return undefined;
}

export function generateTests(specYamlOrJson: string, baseUrlOverride?: string): ExportBundle {
  const doc = parseSpec(specYamlOrJson);
  if (!doc.openapi || !doc.paths) throw new Error("Invalid OpenAPI spec");

  const baseUrl = baseUrlOverride ?? doc.servers?.[0]?.url ?? "http://localhost";
  const requests: RequestItem[] = [];

  for (const [path, methods] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
      const opName = op.operationId || op.summary || `${method.toUpperCase()} ${path}`;
      const authType = inferAuth(doc, op);

      // Build happy path
      const headers: Record<string, string> = {};
      const queryParams: Array<{ key: string; value: string }> = [];
      let url = `${baseUrl}${path}`;
      let body: string | undefined;

      if (op.parameters) {
        for (const p of op.parameters) {
          const val = exampleForParam(p);
          if (p.in === "path") url = url.replace(`{${p.name}}`, encodeURIComponent(val));
          else if (p.in === "query") queryParams.push({ key: p.name, value: val });
          else if (p.in === "header") headers[p.name] = val;
        }
      }

      if (op.requestBody) {
        const jsonContent = op.requestBody.content?.["application/json"];
        if (jsonContent?.schema) {
          body = JSON.stringify(
            buildExampleBody(jsonContent.schema as Record<string, unknown>),
            null,
            2,
          );
        }
      }

      if (authType === "bearer") headers["Authorization"] = "Bearer valid-token";

      function add(name: string, overrides: Partial<RequestItem>, assertExpr: string) {
        requests.push({
          name,
          method: method.toUpperCase() as RequestItem["method"],
          url,
          endpoint: path,
          headers,
          queryParams: queryParams.length > 0 ? queryParams : undefined,
          body,
          bodyType: body ? "json" : undefined,
          assert: [{ expr: assertExpr }],
          ...overrides,
        });
      }

      add(`${opName} (happy path)`, {}, "status < 500");

      if (authType) add(`${opName} (missing auth)`, { headers: undefined }, "status == 401");
      if (authType)
        add(
          `${opName} (invalid auth)`,
          {
            headers: { ...headers, Authorization: "Bearer invalid-token" },
          },
          "status == 401 || status == 403",
        );

      if (op.parameters) {
        for (const p of op.parameters) {
          if (p.in === "query" && p.required) {
            add(
              `${opName} (missing param: ${p.name})`,
              {
                queryParams: queryParams.filter((q) => q.key !== p.name),
              },
              "status == 400 || status == 422",
            );
          }
          if (p.in === "query" && p.schema?.type) {
            const wrong = wrongTypeValue(p.schema.type);
            if (wrong !== undefined) {
              add(
                `${opName} (wrong type: ${p.name})`,
                {
                  queryParams: queryParams.map((q) =>
                    q.key === p.name ? { ...q, value: String(wrong) } : q,
                  ),
                },
                "status == 400 || status == 422",
              );
            }
          }
        }
      }

      if (op.requestBody && method !== "get" && method !== "delete") {
        add(
          `${opName} (invalid body)`,
          {
            body: JSON.stringify({ __invalid: true }),
          },
          "status == 400 || status == 422",
        );
        add(
          `${opName} (empty body)`,
          {
            body: undefined,
            bodyType: undefined,
          },
          "status == 400 || status == 422",
        );
      }

      if (path.includes("{") && op.parameters?.some((p) => p.in === "path")) {
        add(
          `${opName} (not found)`,
          {
            url: url.replace(/\/[^/]+$/, "/nonexistent"),
          },
          "status == 404",
        );
      }
    }
  }

  return {
    version: "1.0",
    exportedAt: new Date().toISOString(),
    collections: [
      {
        name: `Edge-case tests (${new Date().toISOString().split("T")[0]})`,
        description: `Auto-generated edge-case tests from ${doc.info?.title ?? "OpenAPI spec"}`,
        requests,
      },
    ],
  };
}

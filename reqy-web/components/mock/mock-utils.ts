import type { MockConfig, MockRoute } from "@reqly/mock-engine";
import { methodBadge } from "@/lib/http-method-colors";
import type { HttpMethod } from "@/lib/types";

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

export type EditorMethod = (typeof HTTP_METHODS)[number];

const METHOD_SET = new Set<string>(HTTP_METHODS);

let slugCounter = 0;

export function slugify(method: string, path: string): string {
  slugCounter += 1;
  const slug = `${method}-${path}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug || "route"}-${slugCounter}`;
}

export function methodBadgeClass(method: string): string {
  const upper = method.toUpperCase();
  return upper in methodBadge ? methodBadge[upper as HttpMethod] : methodBadge.GET;
}

export function normalizeMethod(method: string): EditorMethod {
  const upper = method.toUpperCase();
  return (METHOD_SET.has(upper) ? upper : "GET") as EditorMethod;
}

export function statusBadgeClass(status: number | null): string {
  if (status == null) return "bg-slate-500/20 text-slate-500 border-slate-500/30";
  if (status < 300) return "bg-emerald-500/20 text-emerald-600 border-emerald-500/30";
  if (status < 400) return "bg-blue-500/20 text-blue-600 border-blue-500/30";
  if (status < 500) return "bg-amber-500/20 text-amber-600 border-amber-500/30";
  return "bg-red-500/20 text-red-600 border-red-500/30";
}

export function createExampleConfig(): MockConfig {
  return {
    version: 1,
    name: "reqly-mock",
    port: 4015,
    cors: true,
    routes: [
      {
        id: "hello-name",
        method: "GET",
        path: "/hello/:name",
        responses: [
          {
            id: "hello-ok",
            statusCode: 200,
            headers: { "content-type": "application/json" },
            body: '{\n  "message": "Bonjour {{request.path.name}} !",\n  "traceId": "{{uuid}}"\n}',
          },
        ],
      },
      {
        id: "users-list",
        method: "GET",
        path: "/api/users",
        responses: [
          {
            id: "users-ok",
            statusCode: 200,
            headers: { "content-type": "application/json" },
            schema: {
              type: "object",
              properties: {
                data: {
                  type: "array",
                  minItems: 2,
                  maxItems: 5,
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string", format: "uuid" },
                      email: { type: "string", format: "email" },
                      displayName: { type: "string", format: "name" },
                    },
                    required: ["id", "email"],
                  },
                },
                total: { type: "integer", min: 20, max: 400 },
              },
              required: ["data", "total"],
            },
          },
        ],
      },
    ],
  };
}

export function makeRoute(method: string, path: string): MockRoute {
  const normalized = normalizeMethod(method);
  const id = slugify(normalized, path);
  return {
    id,
    method: normalized,
    path: path.startsWith("/") ? path : `/${path}`,
    responses: [
      {
        id: `${id}-r1`,
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: '{"ok":true}',
      },
    ],
  };
}

export function duplicateRoute(route: MockRoute): MockRoute {
  const copy = structuredClone(route);
  copy.id = `${route.id}-copy-${slugCounter + 1}`;
  slugCounter += 1;
  copy.responses = (copy.responses ?? []).map((r, i) => ({ ...r, id: `${copy.id}-r${i + 1}` }));
  if (copy.defaultResponseId) copy.defaultResponseId = undefined;
  return copy;
}

const SCHEMA_TYPES = new Set(["object", "array", "string", "number", "integer", "boolean", "null"]);

export function isBodySchema(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const type = (value as { type?: unknown }).type;
  return type === undefined || (typeof type === "string" && SCHEMA_TYPES.has(type));
}

/** Valide et normalise une config importée. Retourne null si fondamentalement invalide. */
export function sanitizeConfig(raw: unknown): MockConfig | null {
  if (raw === null || typeof raw !== "object") return null;
  const candidate = raw as Partial<MockConfig>;
  if (candidate.version !== 1 || !Array.isArray(candidate.routes)) return null;
  const routes: MockRoute[] = [];
  for (const entry of candidate.routes) {
    if (entry === null || typeof entry !== "object") continue;
    const route = entry as Partial<MockRoute>;
    const id =
      typeof route.id === "string" && route.id
        ? route.id
        : slugify(String(route.method ?? "GET"), String(route.path ?? "/"));
    const responses = Array.isArray(route.responses)
      ? route.responses.map((r, i) => ({
          ...(r as MockRoute["responses"][number]),
          id:
            r && typeof r === "object" && typeof (r as { id?: unknown }).id === "string"
              ? (r as { id: string }).id
              : `${id}-r${i + 1}`,
          statusCode:
            r &&
            typeof r === "object" &&
            Number.isFinite(Number((r as { statusCode?: unknown }).statusCode))
              ? Number((r as { statusCode: number }).statusCode)
              : 200,
        }))
      : [];
    routes.push({
      ...route,
      id,
      method: normalizeMethod(String(route.method ?? "GET")),
      path: typeof route.path === "string" && route.path ? route.path : "/",
      responses: responses.length > 0 ? responses : [{ id: `${id}-r1`, statusCode: 200 }],
    });
  }
  return { ...candidate, version: 1, routes };
}

export function downloadMockConfig(config: MockConfig): void {
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "mock.config.json";
  anchor.click();
  URL.revokeObjectURL(url);
}

export function parseSchemaText(text: string): { schema: unknown; valid: boolean } {
  try {
    const parsed: unknown = JSON.parse(text);
    return { schema: parsed, valid: isBodySchema(parsed) };
  } catch {
    return { schema: undefined, valid: false };
  }
}

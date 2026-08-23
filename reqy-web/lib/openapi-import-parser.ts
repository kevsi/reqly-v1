/**
 * OpenAPI / Swagger import parser for Reqly.
 * Supports OpenAPI 3.0, 3.1 and Swagger 2.0 (JSON & YAML).
 */

import yaml from "js-yaml";
import type {
  OpenApiParseResult,
  OpenApiParseSuccess,
  OpenApiEndpoint,
  OpenApiParameter,
  OpenApiRequestBody,
} from "@/lib/openapi-import-types";
import {
  extractOperationParams,
  extractRequestBody,
  extractSecurity,
  extractExampleFromSchema,
} from "@/lib/openapi-import-schema";

// ─── Main parser entry ──────────────────────────────────────────────────────

/** Taille maximale acceptée pour une spec importée (anti-DoS). */
export const MAX_OPENAPI_IMPORT_BYTES = 10 * 1024 * 1024; // 10 Mo

export function parseOpenApiSpec(contents: string, fileName?: string): OpenApiParseResult {
  if (new TextEncoder().encode(contents).length > MAX_OPENAPI_IMPORT_BYTES) {
    return {
      success: false,
      error: `Fichier trop volumineux (max ${MAX_OPENAPI_IMPORT_BYTES / (1024 * 1024)} Mo)`,
    };
  }
  try {
    const doc = parseToJson(contents, fileName);
    if (!doc || typeof doc !== "object") {
      return { success: false, error: "Le fichier ne contient pas un objet JSON/YAML valide." };
    }

    const docAny = doc as Record<string, unknown>;

    // Detect spec version
    if (docAny.swagger && typeof docAny.swagger === "string") {
      return parseSwagger2(docAny);
    }
    if (docAny.openapi && typeof docAny.openapi === "string") {
      return parseOpenApi3(docAny);
    }

    return {
      success: false,
      error: "Format de spécification non reconnu. Utilisez OpenAPI 3.x ou Swagger 2.0.",
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Erreur inconnue lors du parsing.",
    };
  }
}

// ─── OpenAPI 3.x parser ─────────────────────────────────────────────────────

function parseOpenApi3(doc: Record<string, unknown>): OpenApiParseSuccess {
  const info = doc.info as Record<string, unknown> | undefined;
  const title = (info?.title as string) || "API";
  const version = (info?.version as string) || "1.0.0";
  const description = info?.description as string | undefined;

  // Extract base URL from servers
  const servers = doc.servers as Array<Record<string, unknown>> | undefined;
  const baseUrl = extractBaseUrl(servers);

  const paths = doc.paths as Record<string, unknown> | undefined;
  if (!paths || typeof paths !== "object") {
    return {
      success: true,
      spec: { title, version, description, baseUrl },
      endpoints: [],
      tagGroups: [],
      totalEndpoints: 0,
    };
  }

  // Build $ref resolution map from components/schemas
  const components = doc.components as Record<string, unknown> | undefined;
  const schemas = (components?.schemas ?? {}) as Record<string, unknown>;
  const securitySchemes = (components?.securitySchemes ?? {}) as Record<string, unknown>;
  const rootSecurity = (doc.security as Array<Record<string, string[]>>) || [];

  const endpoints: OpenApiEndpoint[] = [];

  for (const [path, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== "object") continue;
    const pathObj = pathItem as Record<string, unknown>;

    // Shared path-level parameters
    const pathParams = extractPathLevelParams(pathObj.parameters);
    const pathSecurity = pathObj.security as Array<Record<string, string[]>> | undefined;

    for (const method of ["get", "post", "put", "patch", "delete", "options", "head"] as const) {
      const operation = pathObj[method] as Record<string, unknown> | undefined;
      if (!operation || typeof operation !== "object") continue;

      const endpoint = buildEndpointFromOperation(
        method.toUpperCase(),
        path,
        operation,
        pathParams,
        schemas,
        pathSecurity ?? rootSecurity,
      );
      endpoints.push(endpoint);
    }
  }

  // Group by tag
  return buildResult(
    title,
    version,
    description,
    baseUrl,
    endpoints,
    rootSecurity,
    securitySchemes,
  );
}

// ─── Swagger 2.0 parser ─────────────────────────────────────────────────────

function parseSwagger2(doc: Record<string, unknown>): OpenApiParseSuccess {
  const info = doc.info as Record<string, unknown> | undefined;
  const title = (info?.title as string) || "API";
  const version = (info?.version as string) || "1.0.0";
  const description = info?.description as string | undefined;

  // Build base URL from swagger 2.0 fields
  const host = doc.host as string | undefined;
  const basePath = (doc.basePath as string) || "";
  const schemes = doc.schemes as string[] | undefined;
  const scheme = schemes?.[0] || "https";
  const baseUrl = host ? `${scheme}://${host}${basePath}` : undefined;

  const paths = doc.paths as Record<string, unknown> | undefined;
  if (!paths || typeof paths !== "object") {
    return {
      success: true,
      spec: { title, version, description, baseUrl },
      endpoints: [],
      tagGroups: [],
      totalEndpoints: 0,
    };
  }

  // Build $ref resolution map from definitions (Swagger 2.0)
  const definitions = (doc.definitions ?? {}) as Record<string, unknown>;
  const securityDefinitions = (doc.securityDefinitions ?? {}) as Record<string, unknown>;
  const rootSecurity = (doc.security as Array<Record<string, string[]>>) || [];

  const endpoints: OpenApiEndpoint[] = [];

  for (const [path, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== "object") continue;
    const pathObj = pathItem as Record<string, unknown>;
    const pathSecurity = pathObj.security as Array<Record<string, string[]>> | undefined;

    for (const method of ["get", "post", "put", "patch", "delete", "options", "head"] as const) {
      const operation = pathObj[method] as Record<string, unknown> | undefined;
      if (!operation || typeof operation !== "object") continue;

      // Swagger 2.0 parameters
      const swaggerParams = (operation.parameters as Array<Record<string, unknown>>) || [];
      const parameters: OpenApiParameter[] = swaggerParams.map((p) => ({
        name: (p.name as string) || "",
        in: (p.in as "query" | "path" | "header" | "cookie") || "query",
        required: !!p.required,
        description: p.description as string | undefined,
        example: p["x-example"] as string | undefined,
      }));

      // Swagger 2.0 request body
      const bodyParams = swaggerParams.filter((p) => p.in === "body");
      let requestBody: OpenApiRequestBody | undefined;
      if (bodyParams.length > 0) {
        const bodyParam = bodyParams[0];
        requestBody = {
          contentType: "application/json",
          required: !!bodyParam.required,
          description: bodyParam.description as string | undefined,
          example: bodyParam.schema
            ? extractExampleFromSchema(
                bodyParam.schema as Record<string, unknown>,
                undefined,
                definitions,
              )
            : undefined,
        };
      }

      // Swagger 2.0 responses example (first 2xx response)
      const responses = operation.responses as Record<string, unknown> | undefined;
      if (!requestBody && responses) {
        for (const [, resp] of Object.entries(responses)) {
          if (resp && typeof resp === "object") {
            break;
          }
        }
      }

      const summary = (operation.summary as string) || `${method.toUpperCase()} ${path}`;
      const tags = (operation.tags as string[]) || [];

      // Security from swagger: operation-level overrides root-level
      const operationSecurity =
        (operation.security as Array<Record<string, string[]>>) || (pathSecurity ?? rootSecurity);

      endpoints.push({
        method: method.toUpperCase(),
        path,
        name: summary,
        description: operation.description as string | undefined,
        tags,
        parameters,
        requestBody,
        security: operationSecurity,
        rootSecurity,
      });
    }
  }

  return buildResult(
    title,
    version,
    description,
    baseUrl,
    endpoints,
    rootSecurity,
    securityDefinitions,
  );
}

// ─── Shared helpers ─────────────────────────────────────────────────────────

function parseToJson(contents: string, _fileName?: string): unknown {
  // Try JSON first
  try {
    return JSON.parse(contents);
  } catch {
    // Not JSON, try YAML
  }

  // Try YAML
  try {
    // JSON_SCHEMA: accept only standard JSON-compatible YAML types. js-yaml v4
    // `load` already rejects `!!js/*` custom tags by default; pinning the
    // schema makes that explicit for untrusted OpenAPI specs.
    return yaml.load(contents, { schema: yaml.JSON_SCHEMA });
  } catch {
    throw new Error(
      "Impossible de parser le fichier. Format non supporté (attendu: JSON ou YAML).",
    );
  }
}

function extractBaseUrl(servers?: Array<Record<string, unknown>>): string | undefined {
  if (!servers || servers.length === 0) return undefined;
  const first = servers[0];
  if (typeof first.url === "string") {
    // Strip trailing slash
    return first.url.replace(/\/+$/, "");
  }
  return undefined;
}

function extractPathLevelParams(parameters: unknown): OpenApiParameter[] {
  if (!Array.isArray(parameters)) return [];
  return parameters
    .filter((p): p is Record<string, unknown> => typeof p === "object" && p !== null)
    .map((p) => ({
      name: (p.name as string) || "",
      in: (p.in as "query" | "path" | "header" | "cookie") || "query",
      required: !!p.required,
      description: p.description as string | undefined,
      example: p.example as string | undefined,
    }));
}

function buildEndpointFromOperation(
  method: string,
  path: string,
  operation: Record<string, unknown>,
  pathParams: OpenApiParameter[],
  rootSchemas: Record<string, unknown> = {},
  pathSecurity: Array<Record<string, string[]>> = [],
): OpenApiEndpoint {
  const summary = (operation.summary as string) || `${method} ${path}`;
  const operationParams = extractOperationParams(operation);
  const allParams = [...pathParams, ...operationParams];

  // Deduplicate parameters by name+in
  const seen = new Set<string>();
  const uniqueParams = allParams.filter((p) => {
    const key = `${p.in}:${p.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const requestBody = extractRequestBody(operation, rootSchemas);
  const tags = (operation.tags as string[]) || [];
  const security = extractSecurity(operation, pathSecurity);

  return {
    method,
    path,
    name: summary,
    description: operation.description as string | undefined,
    tags,
    parameters: uniqueParams,
    requestBody,
    security,
  };
}

function buildResult(
  title: string,
  version: string,
  description: string | undefined,
  baseUrl: string | undefined,
  endpoints: OpenApiEndpoint[],
  rootSecurity?: Array<Record<string, string[]>>,
  securitySchemes?: Record<string, unknown>,
): OpenApiParseSuccess {
  // Group by tag
  const tagMap = new Map<string, OpenApiEndpoint[]>();

  for (const ep of endpoints) {
    const tags = ep.tags.length > 0 ? ep.tags : ["General"];
    for (const tag of tags) {
      if (!tagMap.has(tag)) tagMap.set(tag, []);
      tagMap.get(tag)!.push(ep);
    }
  }

  // Assign endpoints without tags to "General" group is handled above

  const tagGroups = Array.from(tagMap.entries())
    .map(([tag, eps]) => ({
      tag,
      endpoints: eps,
      collectionName: tag,
      description: undefined,
    }))
    .sort((a, b) => a.tag.localeCompare(b.tag));

  // For the "General" group, move it to the end
  const generalIdx = tagGroups.findIndex((g) => g.tag === "General");
  if (generalIdx > 0) {
    const general = tagGroups.splice(generalIdx, 1)[0];
    tagGroups.push(general);
  }

  return {
    success: true,
    spec: {
      title,
      version,
      description,
      baseUrl,
      ...(rootSecurity && rootSecurity.length > 0 ? { rootSecurity } : {}),
      ...(securitySchemes && Object.keys(securitySchemes).length > 0 ? { securitySchemes } : {}),
    },
    endpoints,
    tagGroups,
    totalEndpoints: endpoints.length,
  };
}

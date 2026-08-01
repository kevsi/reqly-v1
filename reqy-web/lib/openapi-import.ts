/**
 * OpenAPI / Swagger import — public API entry.
 *
 * Re-exports all public types and functions.
 * Also contains the collection conversion and merge logic.
 */

import { mergeImport } from "@/lib/import-merge/merge";
import type { ImportSummary } from "@/lib/import-merge/types";
import type {
  OpenApiEndpoint,
  EndpointConversionContext,
  CollectionImportData,
} from "@/lib/openapi-import-types";
import { COLLECTION_COLORS, COLLECTION_ICONS } from "@/lib/openapi-import-types";
import type { ImportOptions, OpenApiParseSuccess } from "@/lib/openapi-import-types";

export { parseOpenApiSpec } from "@/lib/openapi-import-parser";

export type {
  OpenApiParseError,
  OpenApiParseSuccess,
  OpenApiParseResult,
  OpenApiEndpoint,
  OpenApiParameter,
  OpenApiRequestBody,
  TagGroup,
  ImportOptions,
  CollectionImportData,
} from "@/lib/openapi-import-types";

// ─── Collection conversion ──────────────────────────────────────────────────

export function convertToCollections(
  result: OpenApiParseSuccess,
  options: ImportOptions,
): CollectionImportData[] {
  const { groupByTag, baseUrlOverride } = options;
  const context: EndpointConversionContext = {
    baseUrl: baseUrlOverride ?? result.spec.baseUrl,
    securitySchemes: result.spec.securitySchemes,
  };

  if (groupByTag) {
    return result.tagGroups.map((group, index) => ({
      name: group.collectionName,
      description: group.description ?? result.spec.description,
      color: COLLECTION_COLORS[index % COLLECTION_COLORS.length],
      icon: COLLECTION_ICONS[index % COLLECTION_ICONS.length],
      requests: group.endpoints.map((ep) => endpointToRequest(ep, context)),
    }));
  }

  // Single collection with all endpoints
  const name = options.collectionName || result.spec.title || "API Import";
  return [
    {
      name,
      description: result.spec.description,
      color: "emerald",
      icon: "package",
      requests: result.endpoints.map((ep) => endpointToRequest(ep, context)),
    },
  ];
}

// ─── Endpoint → RequestItem converter ───────────────────────────────────────

function mapContentTypeToBodyType(
  contentType?: string,
): CollectionImportData["requests"][number]["bodyType"] {
  if (!contentType) return "raw";
  const ct = contentType.toLowerCase();
  if (ct.includes("application/json") || ct.includes("+json")) return "json";
  if (ct.includes("multipart/form-data")) return "form-data";
  if (ct.includes("application/x-www-form-urlencoded")) return "x-www-form";
  if (
    ct.includes("application/octet-stream") ||
    ct.startsWith("image/") ||
    ct.startsWith("audio/") ||
    ct.startsWith("video/")
  )
    return "binary";
  return "raw";
}

function mapSecurityToAuth(
  security: Array<Record<string, string[]>>,
  securitySchemes?: Record<string, unknown>,
): Pick<CollectionImportData["requests"][number], "authType" | "authToken"> {
  if (security.length === 0 || !securitySchemes) return { authType: "none" };

  // Pick the first alternative from the OR-list of security requirements.
  const firstRequirement = security[0];
  const schemeName = Object.keys(firstRequirement)[0];
  if (!schemeName) return { authType: "none" };

  const scheme = securitySchemes[schemeName];
  if (!scheme || typeof scheme !== "object") return { authType: "none" };
  const s = scheme as Record<string, unknown>;

  const type = String(s.type ?? "").toLowerCase();
  const schemeField = String(s.scheme ?? "").toLowerCase();

  if (type === "http") {
    if (schemeField === "bearer") return { authType: "bearer" };
    if (schemeField === "basic") return { authType: "basic" };
    return { authType: "api-key" };
  }
  if (type === "apikey") return { authType: "api-key" };
  if (type === "oauth2" || type === "openidconnect") return { authType: "oauth2" };

  return { authType: "none" };
}

function endpointToRequest(
  ep: OpenApiEndpoint,
  context: EndpointConversionContext,
): CollectionImportData["requests"][number] {
  const headers: Record<string, string> = {};
  const queryParams: Array<{ key: string; value: string }> = [];
  let url = ep.path;

  // Process parameters
  for (const param of ep.parameters) {
    if (param.in === "header") {
      headers[param.name] = param.example || "";
    } else if (param.in === "query") {
      queryParams.push({ key: param.name, value: param.example || "" });
    }
    // Path params stay as {param} in the URL — user replaces them
  }

  // Build full URL
  if (context.baseUrl) {
    const cleanBase = context.baseUrl.replace(/\/+$/, "");
    url = ep.path.startsWith("/") ? `${cleanBase}${ep.path}` : `${cleanBase}/${ep.path}`;
  }

  const bodyType = ep.requestBody
    ? mapContentTypeToBodyType(ep.requestBody.contentType)
    : undefined;

  const { authType, authToken } = mapSecurityToAuth(ep.security, context.securitySchemes);

  const request: CollectionImportData["requests"][number] = {
    name: ep.name,
    method: ep.method,
    url,
    endpoint: ep.path,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    body: ep.requestBody?.example ?? "",
    bodyType,
    authType,
    authToken,
    queryParams: queryParams.length > 0 ? queryParams : undefined,
  };

  return request;
}

// ─── LWW merge helpers ─────────────────────────────────────────────────────

/**
 * Merge incoming OpenAPI collections against the local store using last-write-wins.
 * Returns the entities to upsert and a conflict summary for the UI banner.
 *
 * Usage:
 *   const { toUpsert, summary } = mergeImportedCollections({
 *     local: store.collections,
 *     imported: parsedCollections,
 *   })
 *   for (const c of toUpsert) store.upsertCollection(c)
 */
export function mergeImportedCollections<
  T extends { id: string; updatedAt?: number; name?: string },
>(args: { local: T[]; imported: T[] }): { toUpsert: T[]; summary: ImportSummary } {
  return mergeImport({ local: args.local, imported: args.imported, entityType: "collection" });
}

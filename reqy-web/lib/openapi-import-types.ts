/**
 * OpenAPI / Swagger import types for Reqly.
 * Supports OpenAPI 3.0, 3.1 and Swagger 2.0 (JSON & YAML).
 */

import type { RequestItem } from "@/lib/types";

// ─── Public types ───────────────────────────────────────────────────────────

export interface OpenApiParseError {
  success: false;
  error: string;
}

export interface OpenApiParseSuccess {
  success: true;
  spec: {
    title: string;
    version: string;
    description?: string;
    baseUrl?: string;
    /** Global security requirements (e.g. `[{ bearerAuth: [] }]`) */
    rootSecurity?: Record<string, string[]>[];
    /** Defined security schemes from `components.securitySchemes` / `securityDefinitions` */
    securitySchemes?: Record<string, unknown>;
  };
  endpoints: OpenApiEndpoint[];
  /** Suggested collections grouped by tag (one collection per tag) */
  tagGroups: TagGroup[];
  /** Total endpoint count across all tags */
  totalEndpoints: number;
}

export type OpenApiParseResult = OpenApiParseSuccess | OpenApiParseError;

export interface OpenApiEndpoint {
  method: string;
  path: string;
  name: string;
  description?: string;
  tags: string[];
  parameters: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  security: Record<string, string[]>[];
  /** Global security requirements inherited from the spec root */
  rootSecurity?: Record<string, string[]>[];
}

export interface OpenApiParameter {
  name: string;
  in: "query" | "path" | "header" | "cookie";
  required: boolean;
  description?: string;
  example?: string;
}

export interface OpenApiRequestBody {
  contentType: string;
  example?: string;
  required: boolean;
  description?: string;
}

export interface TagGroup {
  tag: string;
  endpoints: OpenApiEndpoint[];
  collectionName: string;
  description?: string;
}

export interface ImportOptions {
  /** Override base URL for all endpoints */
  baseUrlOverride?: string;
  /** Group endpoints by tag (one collection per tag). Default: true */
  groupByTag: boolean;
  /** Collection to use when not grouping by tag */
  collectionName?: string;
}

export interface CollectionImportData {
  name: string;
  description?: string;
  color: string;
  icon: string;
  folders?: Array<{ id: string; name: string; parentId?: string | null }>;
  requests: Array<{
    name: string;
    method: string;
    url: string;
    endpoint: string;
    headers?: Record<string, string>;
    body?: string;
    bodyType?: "json" | "form-data" | "x-www-form" | "raw" | "binary";
    authType?: "none" | "bearer" | "basic" | "api-key" | "oauth2";
    authToken?: string;
    queryParams?: Array<{ key: string; value: string }>;
    assertions?: RequestItem["assertions"];
    runnerAssertions?: RequestItem["runnerAssertions"];
    preRequestScript?: string;
    postResponseScript?: string;
    folderId?: string | null;
  }>;
}

// ─── Internal types ─────────────────────────────────────────────────────────

export interface EndpointConversionContext {
  baseUrl?: string;
  securitySchemes?: Record<string, unknown>;
}

// ─── Constants ──────────────────────────────────────────────────────────────

export const COLLECTION_COLORS = ["emerald", "blue", "amber", "purple", "red", "pink"] as const;
export const COLLECTION_ICONS = ["package", "folder", "lock", "users"] as const;

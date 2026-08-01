// ============================================================
// Types partagés — socle commun entre recli, reqy-mcp, reqy-web
// Chaque package étend ces types avec ses spécificités.
// ============================================================

export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS"
  | "TRACE"
  | "CONNECT"
  | "GRAPHQL";

export type BodyType = "none" | "json" | "form-data" | "x-www-form" | "raw" | "binary";

export type AuthType = "none" | "bearer" | "basic" | "api-key" | "oauth2";

export interface Header {
  key: string;
  value: string;
  enabled: boolean;
}

export interface QueryParam {
  key: string;
  value: string;
  enabled?: boolean;
}

export interface EnvironmentVariable {
  key: string;
  value: string;
  enabled: boolean;
}

export interface Environment {
  id?: string;
  name: string;
  color?: string;
  variables: EnvironmentVariable[];
}

export interface GraphQLConfig {
  query: string;
  variables?: Record<string, unknown> | string;
  operationName?: string;
}

export interface Assertion {
  /** Format texte: `status == 200` (recli) ou structuré (reqy-mcp) */
  expr?: string;
  name?: string;
  id?: string;
  type?: string;
  target?: string;
  operator?: string;
  value?: string;
  enabled?: boolean;
  schema?: Record<string, unknown>;
}

export interface AssertionResult {
  passed: boolean;
  error?: string;
  /** Nom de l'assertion (recli) */
  name?: string;
  /** Expression brute (recli) */
  rawExpr?: string;
  expected?: unknown;
  actual?: unknown;
  /** Assertion structurée (reqy-mcp) */
  assertion?: Assertion;
  actualValue?: unknown;
}

// ── Structures de données ──────────────────────────────────

export interface RequestItem {
  id?: string;
  name: string;
  method: HttpMethod;
  url: string;
  endpoint?: string;
  headers?: Record<string, string>;
  body?: string;
  bodyType?: BodyType | "graphql";
  authType?: AuthType;
  authToken?: string;
  queryParams?: Array<{ key: string; value: string }>;
  folderId?: string | null;
  sortOrder: number;
}

export interface Collection {
  id?: string;
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  requests: RequestItem[];
  folders?: CollectionFolder[];
}

export interface CollectionFolder {
  id: string;
  name: string;
  parentId?: string | null;
  collectionId?: string;
  order?: number;
  requests?: string[];
  children?: CollectionFolder[];
}

export interface ExportBundle {
  version?: string;
  exportedAt?: string;
  collections: Collection[];
  environments?: Environment[];
  variableMappings?: Array<{
    id?: string;
    name: string;
    sourceRequestId: string;
    sourcePath: string;
    enabled?: boolean;
  }>;
}

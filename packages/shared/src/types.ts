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
  createdAt?: number;
  updatedAt?: number;
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

/**
 * Règle de capture recli : extrait une valeur de la réponse (body.<path>,
 * headers.<name>, status) et la stocke dans {{name}} pour les requêtes suivantes.
 */
export interface CaptureRule {
  name: string;
  expr: string;
}

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
  queryParams?: QueryParam[];
  folderId?: string | null;
  sortOrder?: number;
  skip?: boolean;
  description?: string;
  /** recli: scripts pre/post (exécutés avant/après la requête) */
  scripts?: { pre?: string; post?: string };
  /** recli: assertions au format texte (expr: "status == 200") */
  assert?: Assertion[];
  /** recli: règles de capture {{var}} pour le chaining */
  capture?: CaptureRule[];
  /** reqy-mcp: script avant requête */
  preRequestScript?: string;
  /** reqy-mcp: script après réponse */
  postResponseScript?: string;
  /** reqy-mcp: assertions structurées (type/target/operator/value) */
  runnerAssertions?: Assertion[];
  /** reqy-mcp: protocole */
  protocol?: "rest" | "graphql";
  graphql?: GraphQLConfig;
  createdAt?: number;
  updatedAt?: number;
}

export interface Collection {
  id?: string;
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  requests: RequestItem[];
  folders?: CollectionFolder[];
  skip?: boolean;
}

export interface CollectionFolder {
  id: string;
  name: string;
  parentId?: string | null;
  collectionId?: string;
  order?: number;
  requests?: string[];
  children?: CollectionFolder[];
  createdAt?: number;
  updatedAt?: number;
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

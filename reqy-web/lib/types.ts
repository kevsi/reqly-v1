export type HttpMethod =
  "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS" | "GRAPHQL";

/** Compute the next order value (fractional between prev/next). */
export function computeOrder(
  prevOrder?: number | null,
  nextOrder?: number | null,
  base?: number,
): number {
  const prev = prevOrder ?? 0;
  const next = nextOrder ?? base ?? prev + 2000;
  // If no gap, shift everything — but in practice fractional insertion gives
  // ~2^53 distinct positions, so hitting this is extremely unlikely.
  if (next - prev < 0.001) return prev + 1;
  return (prev + next) / 2;
}

/** Per-phase response timing, surfaced in the response timeline. */
export interface ResponseTimings {
  dnsMs?: number;
  connectMs?: number;
  ttfbMs?: number;
  totalMs: number;
}

export interface CollectionFolder {
  id: string;
  name: string;
  parentId: string | null;
  collectionId: string;
  order: number;
  createdAt: number;
  updatedAt: number;
}

export interface RequestItem {
  id: string;
  name: string;
  method: HttpMethod;
  /** Display order within its collection/folder. Store assigns a default. */
  order?: number;
  url: string;
  endpoint: string;
  headers?: Record<string, string>;
  body?: string;
  bodyType?: "json" | "form-data" | "x-www-form" | "raw" | "binary";
  authType?: "none" | "bearer" | "basic" | "api-key" | "oauth2";
  authToken?: string;
  queryParams?: Array<{ key: string; value: string }>;
  pathParams?: Array<{ key: string; value: string; enabled?: boolean }>;
  folderId?: string | null;
  /**
   * Legacy assertion format used by the original inline test editor.
   * New code should use {@link runnerAssertions} (lib/test-runner/types.Assertion)
   * which supports richer operators and JSONPath. Kept for backwards
   * compatibility with persisted projects and the legacy UI; do not remove
   * without a migration path. Prefer runnerAssertions for new code.
   * @deprecated since 2024-Q4 — use runnerAssertions instead.
   */
  assertions?: RequestTestAssertion[];
  runnerAssertions?: import("@/lib/test-runner/types").Assertion[];
  preRequestScript?: string;
  postResponseScript?: string;
  datasetKey?: string;
  protocol?: "rest" | "graphql";
  graphql?: {
    query: string;
    variables: string;
    operationName?: string;
  };
  createdAt: number;
  updatedAt: number;
}

export interface HistoryItem extends RequestItem {
  workspaceId?: string;
  responseStatus?: number;
  responseTime?: number;
  responseSize?: string;
  responseBody?: string | Blob;
  executedAt: number;
}

export interface Workspace {
  id: string;
  name: string;
  description?: string;
  color: string;
  icon: string;
  /** Present when workspace comes from the sync server */
  ownerId?: string;
  /** "owner" | "editor" — present when workspace comes from the sync server */
  role?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Collection {
  id: string;
  name: string;
  description?: string;
  color: string;
  icon: string;
  workspaceId?: string;
  requests: RequestItem[];
  folders?: CollectionFolder[];
  createdAt: number;
  updatedAt: number;
}

export interface EnvironmentVariable {
  key: string;
  value: string;
  enabled: boolean;
}

export interface Environment {
  id: string;
  name: string;
  color: string;
  workspaceId?: string;
  variables: EnvironmentVariable[];
  createdAt: number;
  updatedAt: number;
}

export interface VariableMapping {
  id: string;
  name: string;
  sourceRequestId: string;
  sourcePath: string;
  workspaceId?: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Notification {
  id: string;
  title: string;
  body?: string;
  type?: "info" | "success" | "warning" | "error";
  event?: string;
  read: boolean;
  createdAt: number;
}

export type AssertionType = "status" | "bodyContains" | "headerExists" | "jsonPath";

export interface RequestTestAssertion {
  id: string;
  type: AssertionType;
  target: string;
  expected?: string;
  enabled: boolean;
}

export interface TestResult {
  assertionId: string;
  type: AssertionType;
  target: string;
  expected?: string;
  passed: boolean;
  message: string;
}

export type AIProvider =
  | "anthropic"
  | "openai"
  | "openrouter"
  | "gemini"
  | "deepseek"
  | "ollama"
  | "opencode-zen"
  | "custom"
  | "grok"
  | "jina";
export type AnalysisMode = "static" | "ai";

export interface SavedProject {
  id: string;
  name: string;
  framework: string;
  language?: string;
  folderPath: string;
  port?: number;
  routes: import("@/lib/detect-shared").DetectedRoute[];
  analyzedAt: string;
  mode: AnalysisMode;
  workspaceId?: string;
}

export interface GithubConfig {
  token?: string;
}

export interface OllamaConfig {
  host?: string;
  port?: number;
  model?: string;
}

// --- GraphQL additions ---

export interface GraphQLError {
  message: string;
  path?: (string | number)[];
  extensions?: Record<string, unknown>;
}

export interface GraphQLExecuteResult {
  statusCode: number;
  responseTimeMs: number;
  headers: Record<string, string>;
  data?: unknown;
  errors?: GraphQLError[];
  graphqlBody: { data?: unknown; errors?: GraphQLError[] } | unknown;
}

export interface GraphQLRequest {
  endpoint: string;
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
  headers?: Record<string, string>;
}

export type GraphqlMessageType = "data" | "error" | "complete" | "info";

export interface GraphqlSubscriptionMessage {
  id: number;
  type: GraphqlMessageType;
  payload: unknown;
  timestamp: number;
}

export interface GraphqlTab {
  id: string;
  name: string;
  endpoint: string;
  query: string;
  variables: string;
  headers: string;
  operationName?: string;
  schema?: unknown;
  schemaLoading?: boolean;
  response?: GraphQLExecuteResult;
  subscriptionMessages?: GraphqlSubscriptionMessage[];
  saved?: boolean;
  dirty?: boolean;
}

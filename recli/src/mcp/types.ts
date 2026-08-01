export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS"
  | "GRAPHQL"

export interface QueryParam {
  key: string
  value: string
}

export interface Assertion {
  id?: string
  type: "status-code" | "json-path" | "header" | "response-time" | "body-contains"
  target: string
  operator?: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "regex" | "exists" | "notExists"
  value?: string
  enabled?: boolean
}

export interface GraphQLConfig {
  query: string
  variables?: Record<string, unknown>
  operationName?: string
}

export interface RequestItem {
  id: string
  name: string
  method: HttpMethod
  url: string
  endpoint: string
  headers?: Record<string, string>
  body?: string
  bodyType?: "json" | "form-data" | "x-www-form" | "raw" | "binary"
  authType?: "none" | "bearer" | "basic" | "api-key" | "oauth2"
  authToken?: string
  queryParams?: QueryParam[]
  folderId?: string | null
  preRequestScript?: string
  postResponseScript?: string
  runnerAssertions?: Assertion[]
  protocol?: "rest" | "graphql"
  graphql?: GraphQLConfig
  createdAt: number
  updatedAt: number
}

export interface CollectionFolder {
  id: string
  name: string
  parentId: string | null
  collectionId: string
  order: number
  createdAt: number
  updatedAt: number
}

export interface Collection {
  id: string
  name: string
  description?: string
  color: string
  icon: string
  workspaceId?: string
  requests: RequestItem[]
  folders?: CollectionFolder[]
  createdAt: number
  updatedAt: number
}

export interface EnvironmentVariable {
  key: string
  value: string
  enabled: boolean
}

export interface Environment {
  id?: string
  name: string
  color?: string
  variables: EnvironmentVariable[]
  createdAt?: number
  updatedAt?: number
}

export interface ExportBundle {
  version?: string
  exportedAt?: string
  collections: Collection[]
  environments: Environment[]
}

export interface RunResult {
  name: string
  method: HttpMethod
  url: string
  status: number
  statusText: string
  durationMs: number
  size: number
  passed: boolean
  error?: string
  body?: string
}

export interface AssertionResult {
  assertion: Assertion
  passed: boolean
  actualValue: unknown
  error?: string
}

export interface RequestRunRecord {
  id: string
  requestId: string
  requestName: string
  collectionId: string
  collectionName: string
  method: HttpMethod
  url: string
  status: number
  statusText: string
  durationMs: number
  size: number
  passed: boolean
  assertionResults?: AssertionResult[]
  error?: string
  body?: string
  executedAt: number
}

export interface CollectionRunRecord {
  id: string
  collectionId: string
  collectionName: string
  startedAt: number
  completedAt: number
  totalDurationMs: number
  results: RequestRunRecord[]
  summary: {
    total: number
    passed: number
    failed: number
    errored: number
  }
}

export interface RunnerOptions {
  envName?: string
  timeoutMs: number
  allowLocalHosts?: boolean
  maxResponseSize?: number
}

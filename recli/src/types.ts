// Recli types — complétés par les types canoniques dans @reqly/shared
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS" | "TRACE" | "CONNECT" | "GRAPHQL"

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
}

export interface QueryParam {
  key: string
  value: string
}

export interface Assertion {
  expr?: string
  name?: string
  schema?: Record<string, unknown>
}

export interface CaptureRule {
  name: string
  expr: string
}

export interface GraphQLConfig {
  query: string
  variables?: Record<string, unknown>
  operationName?: string
}

export interface RequestItem {
  id?: string
  name: string
  method: HttpMethod
  url: string
  endpoint?: string
  headers?: Record<string, string>
  body?: string
  bodyType?: "json" | "form-data" | "x-www-form" | "raw" | "binary" | "graphql"
  authType?: "none" | "bearer" | "basic" | "api-key" | "oauth2"
  authToken?: string
  queryParams?: QueryParam[]
  folderId?: string | null
  assert?: Assertion[]
  capture?: CaptureRule[]
  scripts?: {
    pre?: string
    post?: string
  }
  graphql?: GraphQLConfig
  skip?: boolean
  description?: string
}

export interface Collection {
  id?: string
  name: string
  description?: string
  color?: string
  icon?: string
  requests: RequestItem[]
  skip?: boolean
}

export interface VariableMapping {
  id?: string
  name: string
  sourceRequestId: string
  sourcePath: string
  enabled?: boolean
}

export interface ExportBundle {
  version?: string
  exportedAt?: string
  collections: Collection[]
  environments?: Environment[]
  variableMappings?: VariableMapping[]
}

export interface RunnerContext {
  vars: Map<string, string>
  envVars: Map<string, string>
  cookies: Map<string, string>
  iteration: number
  data?: Record<string, string>
}

export interface AssertionResult {
  name: string
  passed: boolean
  rawExpr?: string
  expected: string
  actual: string
  error?: string
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
  assertions?: AssertionResult[]
  capturedVars?: Record<string, string>
  responseHeaders?: Record<string, string>
  responseCookies?: Record<string, string>
  snapshotChanged?: boolean
  timestamp: number
}

export interface RunnerOptions {
  envName?: string
  timeoutMs: number
  requestName?: string
  noColor?: boolean
  json?: boolean
  parallel?: boolean
  delayMs?: number
  iterations?: number
  dataFile?: string
  reporter?: string
  output?: string
  snapshot?: boolean
  updateSnapshots?: boolean
  dotenv?: string
  workspace?: string
  allowLocalHosts?: boolean
  maxResponseSize?: number
}

export interface RecliConfig {
  env?: string
  timeout?: number
  parallel?: boolean
  delay?: number
  iterations?: number
  reporter?: string
  output?: string
  data?: string
  snapshot?: boolean
  updateSnapshots?: boolean
  dotenv?: string
}

export interface ValidationError {
  path: string
  message: string
}

export type ReportFormat = "cli" | "json" | "junit" | "html"

export interface DiffResult {
  name: string
  url: string
  statusChanged: boolean
  oldStatus: number
  newStatus: number
  bodyChanged: boolean
  bodyDiff?: string
  durationChanged: boolean
  oldDuration: number
  newDuration: number
  passedBefore: boolean
  passedAfter: boolean
}

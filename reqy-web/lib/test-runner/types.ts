export type AssertionStatus = "pass" | "fail" | "skipped" | "errored"

export type Assertion =
  | { type: "status"; expected: number | { in: number[] } | { not: number } }
  | { type: "responseTime"; operator: "<" | "<=" | ">" | ">="; valueMs: number }
  | { type: "jsonPath"; path: string; operator: "equals" | "contains" | "exists" | "notExists"; value?: unknown }
  | { type: "schema"; schema: Record<string, unknown> }

export interface AssertionResult {
  assertion: Assertion
  passed: boolean
  actualValue: unknown
  error?: string
}

export interface RequestTestResult {
  requestId: string
  requestName: string
  status: AssertionStatus
  statusCode?: number
  responseTimeMs?: number
  assertionResults: AssertionResult[]
  scriptOutput?: { pre?: string; post?: string }
  error?: string
}

export interface CollectionRunReport {
  collectionId: string
  collectionName: string
  startedAt: number
  completedAt: number
  totalDurationMs: number
  results: RequestTestResult[]
  summary: { total: number; passed: number; failed: number; skipped: number; errored: number }
}

export interface RequestResponse {
  statusCode: number
  responseTimeMs: number
  body: unknown
  headers: Record<string, string>
}

export interface RunnerContext {
  environment: Record<string, string>
  iterationData: Record<string, string>
  iterationIndex: number
  log: (msg: string) => void
}

export type AssertionStatus = "pass" | "fail" | "skipped" | "errored";

export type Assertion =
  | { type: "status"; expected: number | { in: number[] } | { not: number } }
  | { type: "responseTime"; operator: "<" | "<=" | ">" | ">="; valueMs: number }
  | {
      type: "jsonPath";
      path: string;
      operator: "equals" | "contains" | "exists" | "notExists";
      value?: unknown;
    }
  | { type: "header"; name: string; operator: "exists" | "equals" | "contains"; value?: string }
  | { type: "schema"; schema: Record<string, unknown> };

export interface AssertionResult {
  assertion: Assertion;
  passed: boolean;
  actualValue: unknown;
  error?: string;
}

export interface RequestTestResult {
  requestId: string;
  requestName: string;
  status: AssertionStatus;
  statusCode?: number;
  responseTimeMs?: number;
  assertionResults: AssertionResult[];
  scriptOutput?: { pre?: string; post?: string };
  error?: string;
  /**
   * Truncated response body (hard cap 2000 chars) captured for the
   * AI-assisted assertion-correction flow ("Corriger avec l'IA").
   */
  responseBodyExcerpt?: string;
}

export interface VariableExtractionRule {
  id: string;
  source: "jsonPath" | "header" | "status";
  path: string;
  variableName: string;
}

export interface PerformanceReport {
  throughputRps: number;
  avgLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  errorRatePercent: number;
  virtualUsers: number;
}

export interface CollectionRunReport {
  collectionId: string;
  collectionName: string;
  startedAt: number;
  completedAt: number;
  totalDurationMs: number;
  results: RequestTestResult[];
  summary: { total: number; passed: number; failed: number; skipped: number; errored: number };
  performanceReport?: PerformanceReport;
  /**
   * "cumulative" when totalDurationMs sums several passes over the same
   * collection (e.g. after a partial "re-run failed"), so the UI can label
   * the duration honestly instead of implying a single pass.
   */
  durationKind?: "total" | "cumulative";
}

export interface RequestResponse {
  statusCode: number;
  responseTimeMs: number;
  body: unknown;
  headers: Record<string, string>;
}

export interface RunnerContext {
  environment: Record<string, string>;
  iterationData: Record<string, string>;
  iterationIndex: number;
  log: (msg: string) => void;
}

// Recli types — socle commun depuis @reqly/shared (types canoniques) + spécificités CLI.
// Les formats de requêtes (recli: scripts/assert/capture + mcp: runnerAssertions/pre/post)
// sont unifiés dans @reqly/shared ; ce fichier ne garde que ce qui est propre au CLI.

import type {
  HttpMethod,
  BodyType,
  AuthType,
  EnvironmentVariable,
  Environment,
  QueryParam,
  Assertion,
  AssertionResult,
  GraphQLConfig,
  RequestItem,
  Collection,
  CollectionFolder,
  CaptureRule,
  ExportBundle,
} from "@reqly/shared";

export type {
  HttpMethod,
  BodyType,
  AuthType,
  EnvironmentVariable,
  Environment,
  QueryParam,
  Assertion,
  AssertionResult,
  GraphQLConfig,
  RequestItem,
  Collection,
  CollectionFolder,
  CaptureRule,
  ExportBundle,
};

export interface RunnerContext {
  vars: Map<string, string>;
  envVars: Map<string, string>;
  cookies: Map<string, string>;
  iteration: number;
  data?: Record<string, string>;
}

export interface RunResult {
  name: string;
  method: HttpMethod;
  url: string;
  status: number;
  statusText: string;
  durationMs: number;
  size: number;
  passed: boolean;
  error?: string;
  body?: string;
  assertions?: AssertionResult[];
  capturedVars?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  responseCookies?: Record<string, string>;
  snapshotChanged?: boolean;
  timestamp: number;
}

export interface RunnerOptions {
  envName?: string;
  timeoutMs: number;
  requestName?: string;
  noColor?: boolean;
  json?: boolean;
  parallel?: boolean;
  delayMs?: number;
  iterations?: number;
  dataFile?: string;
  reporter?: string;
  output?: string;
  snapshot?: boolean;
  updateSnapshots?: boolean;
  dotenv?: string;
  workspace?: string;
  allowLocalHosts?: boolean;
  maxResponseSize?: number;
  /** Stop the collection at the first failed request (fail-fast). */
  bail?: boolean;
  /** Number of retries on transient failures (network errors or matching status codes). */
  retries?: number;
  /** HTTP status codes that trigger a retry (default: 429, 502, 503, 504). */
  retryOnStatus?: number[];
  /** Base delay in ms for exponential backoff between retries (default: 300). */
  retryDelayMs?: number;
}

export interface RecliConfig {
  env?: string;
  timeout?: number;
  parallel?: boolean;
  delay?: number;
  iterations?: number;
  reporter?: string;
  output?: string;
  data?: string;
  snapshot?: boolean;
  updateSnapshots?: boolean;
  dotenv?: string;
  /** Allow pm.sendRequest in scripts to reach localhost/private networks. */
  allowLocalHosts?: boolean;
  bail?: boolean;
  retries?: number;
  /** Comma-separated status codes, e.g. "429,503,504". */
  retryOn?: string;
  retryDelay?: number;
}

export interface ValidationError {
  path: string;
  message: string;
}

export type ReportFormat = "cli" | "json" | "junit" | "html";

export interface DiffResult {
  name: string;
  url: string;
  statusChanged: boolean;
  oldStatus: number;
  newStatus: number;
  bodyChanged: boolean;
  bodyDiff?: string;
  durationChanged: boolean;
  oldDuration: number;
  newDuration: number;
  passedBefore: boolean;
  passedAfter: boolean;
}

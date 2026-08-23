/**
 * Shared types for the ReqlyAI Copilot module.
 * See spec: docs/superpowers/specs/2026-06-25-reqlyai-copilot-design.md
 *
 * Re-exports HttpMethod from the existing project types.
 */
import type { HttpMethod, AIProvider } from "@/lib/types";

export type { HttpMethod, AIProvider };

// ─── Context ──────────────────────────────────────────────────────────────

export type AuthType = "none" | "bearer" | "basic" | "apikey" | "oauth2";

export interface RequestPayload {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  authType: AuthType;
}

export interface ResponsePayload {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: unknown;
  duration: number; // ms
  size: number; // bytes
}

import type { TauriErrorPayload } from "@/lib/tauri";

/** IPC-derived error codes plus the legacy AI aliases kept for compatibility. */
export type NetworkErrorType =
  TauriErrorPayload["code"] | "network" | "ssl" | "dns" | "timeout" | "unknown";

export interface NetworkError extends Pick<TauriErrorPayload, "message" | "code"> {
  type: NetworkErrorType;
  detail?: string;
}

export interface RequestContext {
  request: RequestPayload;
  response?: ResponsePayload;
  error?: NetworkError;
  /** Capture timestamp (ms epoch) — used to measure engine latency. */
  timestamp: number;
}

export interface RetrievedChunk {
  source: string;
  content: string;
  score?: number;
  origin?: string;
}

// ─── Diagnostic ───────────────────────────────────────────────────────────

export type Severity = "error" | "warning" | "info";
export type Confidence = "certain" | "probable" | "uncertain";
export type DiagnosticSource = "local" | "llm" | "rag";
export type DiagnosticCategory = "auth" | "format" | "performance" | "ssl" | "server" | "business";

export type FixType = "header" | "body" | "url" | "auth" | "method";

export interface Fix {
  type: FixType;
  description: string;
  patch: Partial<RequestPayload>;
  applyFix: () => Partial<RequestPayload>;
}

export interface Diagnostic {
  id: string;
  severity: Severity;
  category: DiagnosticCategory;
  title: string;
  explanation: string;
  fix?: Fix;
  confidence: Confidence;
  source: DiagnosticSource;
  references?: Array<{ label: string; url: string }>;
  timestamp: number;
}

// ─── Rule (local engine) ──────────────────────────────────────────────────

/**
 * A rule inspects a RequestContext and, if matched, builds a Diagnostic.
 * Rules are pure functions — no side effects, no I/O.
 */
export interface Rule {
  /** Stable identifier, e.g. "auth.401.bearer.missing". */
  id: string;
  category: DiagnosticCategory;
  severity: Severity;
  match: (ctx: RequestContext) => boolean;
  build: (ctx: RequestContext) => Omit<Diagnostic, "id" | "timestamp" | "source">;
}

// ─── LLM streaming (Phase 2 placeholder, defined here for type reuse) ────

export type LLMStreamChunkType = "start" | "token" | "diagnostic" | "done" | "error";

export interface LLMStreamChunk {
  type: LLMStreamChunkType;
  content?: string;
  diagnostic?: Diagnostic;
  error?: string;
}

/**
 * Phase 7.2 — Performance monitoring (P50 / P95 latency)
 *
 * Records latency samples per label and exposes percentile + summary
 * statistics. Backed by a small ring buffer (no external deps).
 *
 * Intended to be used by the AI engine (streamLLM, callAI, analyze)
 * to track call durations in development / telemetry.
 */

const DEFAULT_CAPACITY = 1000;

interface Buffer {
  capacity: number;
  values: number[];
  /** next insertion index */
  cursor: number;
  /** how many samples have been written (until capacity reached) */
  size: number;
}

const buffers = new Map<string, Buffer>();

export type AICallOutcome = "success" | "error" | "timeout";
export interface AICallEvent {
  provider: string;
  model: string;
  outcome: AICallOutcome;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
}
const AI_CALL_EVENT_CAPACITY = 1000;
const aiCallEvents: AICallEvent[] = [];

/** Record bounded, secret-free metadata for one LLM call. */
export function recordAICall(event: AICallEvent): void {
  if (!Number.isFinite(event.durationMs) || event.durationMs < 0) return;
  aiCallEvents.push({
    provider: event.provider,
    model: event.model,
    outcome: event.outcome,
    durationMs: event.durationMs,
    inputTokens: Number.isFinite(event.inputTokens) ? Math.max(0, event.inputTokens) : 0,
    outputTokens: Number.isFinite(event.outputTokens) ? Math.max(0, event.outputTokens) : 0,
  });
  if (aiCallEvents.length > AI_CALL_EVENT_CAPACITY) aiCallEvents.shift();
}

export interface AICallStats {
  count: number;
  successes: number;
  errors: number;
  timeouts: number;
  avgDurationMs: number;
  inputTokens: number;
  outputTokens: number;
}

export function getAICallStats(filter?: { provider?: string; model?: string }): AICallStats {
  const events = aiCallEvents.filter(
    (event) =>
      (!filter?.provider || event.provider === filter.provider) &&
      (!filter?.model || event.model === filter.model),
  );
  const duration = events.reduce((sum, event) => sum + event.durationMs, 0);
  return {
    count: events.length,
    successes: events.filter((event) => event.outcome === "success").length,
    errors: events.filter((event) => event.outcome === "error").length,
    timeouts: events.filter((event) => event.outcome === "timeout").length,
    avgDurationMs: events.length ? duration / events.length : 0,
    inputTokens: events.reduce((sum, event) => sum + event.inputTokens, 0),
    outputTokens: events.reduce((sum, event) => sum + event.outputTokens, 0),
  };
}

export function resetAICallEvents(): void {
  aiCallEvents.length = 0;
}

function getBuffer(label: string, capacity: number): Buffer {
  let buf = buffers.get(label);
  if (!buf) {
    buf = { capacity, values: new Array(capacity).fill(0), cursor: 0, size: 0 };
    buffers.set(label, buf);
  }
  return buf;
}

/** Record a latency sample in milliseconds. */
export function recordLatency(
  label: string,
  ms: number,
  options: { capacity?: number } = {},
): void {
  if (!Number.isFinite(ms) || ms < 0) return;
  const buf = getBuffer(label, options.capacity ?? DEFAULT_CAPACITY);
  buf.values[buf.cursor] = ms;
  buf.cursor = (buf.cursor + 1) % buf.capacity;
  if (buf.size < buf.capacity) buf.size++;
}

export interface LatencyStats {
  count: number;
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
}

/** Read-only snapshot of latency statistics for a label. */
export function getLatencyStats(label: string): LatencyStats | null {
  const buf = buffers.get(label);
  if (!buf || buf.size === 0) return null;
  const slice = buf.values.slice(0, buf.size);
  const sorted = [...slice].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const pct = (p: number) => {
    if (sorted.length === 0) return 0;
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[idx];
  };
  return {
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: sum / sorted.length,
    p50: pct(50),
    p95: pct(95),
    p99: pct(99),
  };
}

/** Reset all samples for a given label (useful for tests). */
export function resetLatency(label: string): void {
  buffers.delete(label);
}

/** Reset all labels (useful for tests). */
export function resetAllLatency(): void {
  buffers.clear();
}

/** Convenience: time an async function and record the elapsed ms. */
export async function timeAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = typeof performance !== "undefined" ? performance.now() : Date.now();
  try {
    return await fn();
  } finally {
    const end = typeof performance !== "undefined" ? performance.now() : Date.now();
    recordLatency(label, end - start);
  }
}

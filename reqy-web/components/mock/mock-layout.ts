"use client";

export const MOCKS_LAYOUT_KEY = "reqly-mocks-layout";

export interface MocksLayout {
  /** Left panel width in percent (clamped 22–50). */
  left?: number;
  /** Logs panel height in percent (clamped 14–60). */
  logs?: number;
  /** Whether the logs panel is collapsed. */
  logsCollapsed?: boolean;
}

const LEFT_MIN = 22;
const LEFT_MAX = 50;
const LOGS_MIN = 14;
const LOGS_MAX = 60;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function loadMocksLayout(): MocksLayout {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(MOCKS_LAYOUT_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const candidate = parsed as Record<string, unknown>;
    const out: MocksLayout = {};
    if (typeof candidate.left === "number" && Number.isFinite(candidate.left)) {
      out.left = clamp(candidate.left, LEFT_MIN, LEFT_MAX);
    }
    if (typeof candidate.logs === "number" && Number.isFinite(candidate.logs)) {
      out.logs = clamp(candidate.logs, LOGS_MIN, LOGS_MAX);
    }
    if (typeof candidate.logsCollapsed === "boolean") out.logsCollapsed = candidate.logsCollapsed;
    return out;
  } catch {
    return {};
  }
}

export function saveMocksLayout(layout: MocksLayout): void {
  try {
    window.localStorage.setItem(MOCKS_LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // quota or private mode — layout persistence is best-effort
  }
}

export const MOCKS_LEFT_LIMITS = { min: LEFT_MIN, max: LEFT_MAX } as const;
export const MOCKS_LOGS_LIMITS = { min: LOGS_MIN, max: LOGS_MAX } as const;

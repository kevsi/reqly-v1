"use client";

import type { AdminConfig } from "./config";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function get<T>(base: string, token: string, path: string): Promise<T> {
  const res = await fetch(`${base.replace(/\/$/, "")}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    if (res.status === 401) throw new ApiError(401, "401 — token invalide");
    throw new ApiError(res.status, `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

async function post<T>(base: string, token: string, path: string): Promise<T> {
  const res = await fetch(`${base.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    if (res.status === 401) throw new ApiError(401, "401 — token invalide");
    throw new ApiError(res.status, `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

// ── Sync-server admin API ────────────────────────────────────────────────

export interface SyncStats {
  users: number;
  verifiedUsers: number;
  oauthUsers: number;
  disabledUsers: number;
  workspaces: number;
  memberships: number;
  pendingInvitations: number;
  collections: number;
  generatedAt: number;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  verified: boolean;
  createdAt: number;
  disabled: boolean;
  lockedUntil: number | null;
  provider: "oauth" | "password";
  workspaceCount: number;
  lastActivityAt: number | null;
}

export interface AdminUserDetail extends AdminUser {
  memberships: Array<{
    workspace_id: string;
    workspace_name: string;
    role: string;
    created_at: number;
  }>;
}

export interface AdminWorkspace {
  id: string;
  name: string;
  ownerEmail: string | null;
  memberCount: number;
  collectionCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface ActivityEntry {
  id: number;
  action: string;
  entityType: string | null;
  entityId: string | null;
  actorEmail: string | null;
  workspaceName: string | null;
  createdAt: number;
}

export function syncApi(cfg: AdminConfig) {
  const b = cfg.syncBase.trim().replace(/\/$/, "");
  const t = cfg.syncToken.trim();
  return {
    stats: () => get<SyncStats>(b, t, "/api/admin/stats"),
    users: (query = "", limit = 50, offset = 0) =>
      get<{ users: AdminUser[]; total: number }>(
        b,
        t,
        `/api/admin/users?limit=${limit}&offset=${offset}${query ? `&query=${encodeURIComponent(query)}` : ""}`,
      ),
    userDetail: (id: string) => get<{ user: AdminUserDetail }>(b, t, `/api/admin/users/${id}`),
    disableUser: (id: string) => post<{ ok: boolean }>(b, t, `/api/admin/users/${id}/disable`),
    enableUser: (id: string) => post<{ ok: boolean }>(b, t, `/api/admin/users/${id}/enable`),
    revokeSessions: (id: string) =>
      post<{ ok: boolean }>(b, t, `/api/admin/users/${id}/revoke-sessions`),
    workspaces: (limit = 100, offset = 0) =>
      get<{ workspaces: AdminWorkspace[]; total: number }>(
        b,
        t,
        `/api/admin/workspaces?limit=${limit}&offset=${offset}`,
      ),
    activity: (limit = 50, offset = 0) =>
      get<{ activity: ActivityEntry[] }>(
        b,
        t,
        `/api/admin/activity?limit=${limit}&offset=${offset}`,
      ),
  };
}

// ── reqly-monitor API ────────────────────────────────────────────────────

export interface LogRow {
  timestamp: number;
  method: string | null;
  path: string | null;
  status: number | null;
  duration_ms: number | null;
}

export interface Snapshot {
  timestamp: number;
  cpu_percent: number | null;
  ram_percent: number | null;
  disk_percent: number | null;
}

export interface SeriesPoint {
  bucketStart: number;
  count: number;
  avgMs: number | null;
  p95Ms: number | null;
  errorRatePercent: number | null;
}

export interface Metrics {
  range: string;
  bucketMs: number;
  series: SeriesPoint[];
  requestsPerMinute: Array<{ bucketStart: number; count: number }>;
  errorRatePercent: number | null;
  latencyAvgMs: number | null;
  latencyP95Ms: number | null;
  hostSnapshots: Snapshot[];
}

export interface MonitorHealth {
  host: Snapshot | null;
  logFreshness: { lastLogAt: number | null; now: number } | null;
  syncServer: { ok: boolean; status: number | null; checkedAt: number } | null;
}

export function monitorApi(cfg: AdminConfig) {
  const b = cfg.monitorBase.trim().replace(/\/$/, "");
  const t = cfg.monitorToken.trim();
  return {
    metrics: (range: "1h" | "24h" | "7d") => get<Metrics>(b, t, `/api/metrics?range=${range}`),
    health: () => get<MonitorHealth>(b, t, "/api/health"),
    logs: (since?: number) =>
      get<{ logs: LogRow[] }>(b, t, `/api/logs?limit=80${since ? `&since=${since}` : ""}`),
  };
}

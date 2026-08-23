"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Users,
  FolderKanban,
  Layers,
  MailQuestion,
  ShieldAlert,
  Activity as ActivityIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  syncApi,
  monitorApi,
  type SyncStats,
  type Metrics,
  type ActivityEntry,
  type MonitorHealth,
} from "@/lib/api";
import type { AdminConfig } from "@/lib/config";
import { fmtAgo, fmtDateTime } from "@/lib/utils";

function Kpi({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof Users;
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 pt-0">
        <div className="bg-primary/10 text-primary flex h-11 w-11 shrink-0 items-center justify-center rounded-lg">
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <p className="text-muted-foreground truncate text-xs">{label}</p>
          <p className="metric-mono text-2xl font-semibold leading-tight">{value}</p>
          {sub && <p className="text-muted-foreground text-[11px]">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

export function OverviewSection({
  config,
  onNeedSettings,
}: {
  config: AdminConfig;
  onNeedSettings: () => void;
}) {
  const [stats, setStats] = useState<SyncStats | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [health, setHealth] = useState<MonitorHealth | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const api = syncApi(config);
      const [s, a] = await Promise.all([api.stats(), api.activity(6)]);
      setStats(s);
      setActivity(a.activity);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    if (config.monitorBase.trim() && config.monitorToken.trim()) {
      try {
        const mon = monitorApi(config);
        const [m, h] = await Promise.all([mon.metrics("1h"), mon.health()]);
        setMetrics(m);
        setHealth(h);
      } catch {
        /* monitoring non bloquant */
      }
    }
  }, [config]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  if (error) {
    return (
      <Card className="border-destructive/50">
        <CardContent className="pt-6">
          <p className="text-sm text-destructive">Erreur : {error}</p>
          <p className="text-muted-foreground mt-1 text-xs">
            Vérifie la configuration (base URL + ADMIN_TOKEN).
          </p>
        </CardContent>
      </Card>
    );
  }

  const lastBucket = metrics?.series.at(-1);
  const errRate = metrics?.errorRatePercent;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {stats ? (
          <>
            <Kpi
              icon={Users}
              label="Utilisateurs"
              value={stats.users}
              sub={`${stats.oauthUsers} OAuth · ${stats.verifiedUsers} vérifiés`}
            />
            <Kpi
              icon={FolderKanban}
              label="Workspaces"
              value={stats.workspaces}
              sub={`${stats.memberships} membres`}
            />
            <Kpi icon={Layers} label="Collections" value={stats.collections} />
            <Kpi
              icon={stats.pendingInvitations > 0 ? MailQuestion : MailQuestion}
              label="Invitations en attente"
              value={stats.pendingInvitations}
            />
          </>
        ) : (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[92px]" />)
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Trafic (1h)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="metric-mono text-3xl font-semibold">
              {lastBucket ? lastBucket.count : "—"}
              <span className="text-muted-foreground ml-2 text-sm font-normal">req/min</span>
            </p>
            <div className="mt-3 flex gap-4 text-xs">
              <span>
                Erreurs{" "}
                <span
                  className={`metric-mono ${errRate != null && errRate > 5 ? "text-destructive" : errRate != null && errRate > 1 ? "text-chart-4" : "text-primary"}`}
                >
                  {errRate == null ? "—" : `${errRate.toFixed(1)}%`}
                </span>
              </span>
              <span>
                p95{" "}
                <span className="metric-mono">
                  {metrics?.latencyP95Ms == null ? "—" : `${metrics.latencyP95Ms} ms`}
                </span>
              </span>
              <span>
                Sync-server{" "}
                <span
                  className={
                    health?.syncServer == null
                      ? ""
                      : health.syncServer.ok
                        ? "text-primary"
                        : "text-destructive"
                  }
                >
                  {health?.syncServer == null
                    ? "…"
                    : health.syncServer.ok
                      ? `up ${health.syncServer.status ?? ""}`
                      : "down"}
                </span>
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-sm">
              Hôte EC2
              <ShieldAlert
                className={`size-4 ${stats && stats.disabledUsers > 0 ? "text-destructive" : "text-muted-foreground"}`}
              />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {(["CPU", "RAM", "Disque"] as const).map((label, i) => {
              const v = health?.host
                ? ([health.host.cpu_percent, health.host.ram_percent, health.host.disk_percent][
                    i
                  ] ?? 0)
                : null;
              const pct = Math.min(100, Math.max(0, v ?? 0));
              return (
                <div key={label}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="metric-mono">{v == null ? "—" : `${Math.round(pct)}%`}</span>
                  </div>
                  <div className="bg-secondary h-1.5 overflow-hidden rounded-full">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${pct >= 90 ? "bg-destructive" : pct >= 75 ? "bg-chart-4" : "bg-primary"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5 text-sm">
              <ActivityIcon className="text-muted-foreground size-4" /> Activité récente
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {activity.length === 0 && (
              <p className="text-muted-foreground text-xs">Aucune activité</p>
            )}
            {activity.map((a) => (
              <div key={a.id} className="flex items-baseline justify-between gap-2 text-xs">
                <div className="min-w-0">
                  <p className="metric-mono truncate font-medium">{a.action}</p>
                  <p className="text-muted-foreground truncate">
                    {a.actorEmail ?? "?"} · {a.workspaceName ?? "—"}
                  </p>
                </div>
                <span className="text-muted-foreground shrink-0">{fmtAgo(a.createdAt)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {stats && (
        <p className="text-muted-foreground text-center text-[11px]">
          Généré à {fmtDateTime(stats.generatedAt)} · rafraîchi toutes les 30 s
        </p>
      )}
    </div>
  );
}

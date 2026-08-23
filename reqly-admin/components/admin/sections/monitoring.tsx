"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { monitorApi, type LogRow } from "@/lib/api";
import type { AdminConfig } from "@/lib/config";
import { fmtTime, fmtBucket } from "@/lib/chart-utils";

type Range = "1h" | "24h" | "7d";

export function MonitoringSection({ config }: { config: AdminConfig }) {
  const [range, setRange] = useState<Range>("1h");
  const [seriesData, setSeriesData] = useState<Array<{
    t: string;
    req: number;
    err: number | null;
    avg: number | null;
    p95: number | null;
  }> | null>(null);
  const [host, setHost] = useState<{
    cpu: number | null;
    ram: number | null;
    disk: number | null;
    ts: number | null;
  } | null>(null);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const api = monitorApi(config);
      const m = await api.metrics(range);
      setSeriesData(
        m.series.map((s) => ({
          t: fmtBucket(s.bucketStart, range),
          req: s.count,
          err: s.errorRatePercent == null ? null : Number(s.errorRatePercent.toFixed(2)),
          avg: s.avgMs,
          p95: s.p95Ms,
        })),
      );
      const h = await api.health();
      setHost({
        cpu: h.host?.cpu_percent ?? null,
        ram: h.host?.ram_percent ?? null,
        disk: h.host?.disk_percent ?? null,
        ts: h.host?.timestamp ?? null,
      });
      const l = await api.logs();
      setLogs(l.logs);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [config, range]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  const statusDist = useMemo(() => {
    const d = { ok: 0, warn: 0, err: 0 };
    for (const l of logs) {
      if (l.status == null) continue;
      if (l.status < 300) d.ok++;
      else if (l.status < 500) d.warn++;
      else d.err++;
    }
    return d;
  }, [logs]);

  if (error) {
    return (
      <Card className="border-destructive/50">
        <CardContent className="pt-6">
          <p className="text-sm text-destructive">Monitoring indisponible : {error}</p>
          <p className="text-muted-foreground mt-1 text-xs">
            Configure monitorBase + token dans Réglages.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Monitoring infrastructure</h2>
        <div className="bg-secondary flex gap-1 rounded-lg p-1">
          {(["1h", "24h", "7d"] as Range[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${range === r ? "bg-background shadow" : "text-muted-foreground hover:text-foreground"}`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">Requêtes / minute</CardTitle>
          </CardHeader>
          <CardContent>
            {seriesData ? (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={seriesData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                  <defs>
                    <linearGradient id="gReq" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="t"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={40}
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                  />
                  <RTooltip
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    labelStyle={{ color: "var(--muted-foreground)" }}
                  />
                  <Area
                    type="monotone"
                    dataKey="req"
                    name="req/min"
                    stroke="var(--chart-1)"
                    strokeWidth={2}
                    fill="url(#gReq)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <Skeleton className="h-[260px]" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Hôte EC2</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(["CPU", "RAM", "Disque"] as const).map((label, i) => {
              const v = host ? [host.cpu, host.ram, host.disk][i] : null;
              const pct = Math.min(100, Math.max(0, v ?? 0));
              return (
                <div key={label}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="metric-mono">{v == null ? "—" : `${Math.round(pct)}%`}</span>
                  </div>
                  <div className="bg-secondary h-2 overflow-hidden rounded-full">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${pct >= 90 ? "bg-destructive" : pct >= 75 ? "bg-chart-4" : "bg-primary"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
            <div className="text-muted-foreground flex justify-between pt-1 text-[11px]">
              <span>2xx/3xx · 4xx · 5xx (logs récents)</span>
              <span className="metric-mono">
                {statusDist.ok} · {statusDist.warn} · {statusDist.err}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">Latence — moyenne vs p95 (ms)</CardTitle>
          </CardHeader>
          <CardContent>
            {seriesData ? (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={seriesData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="t"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={40}
                  />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <RTooltip
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="avg"
                    name="moyenne"
                    stroke="var(--chart-1)"
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="p95"
                    name="p95"
                    stroke="var(--chart-4)"
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <Skeleton className="h-[220px]" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Taux d&apos;erreur (%)</CardTitle>
          </CardHeader>
          <CardContent>
            {seriesData ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={seriesData.filter((d) => d.err != null)}
                  margin={{ top: 4, right: 8, bottom: 0, left: -20 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="t"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={40}
                  />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <RTooltip
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Bar
                    type="monotone"
                    dataKey="err"
                    name="% erreurs"
                    fill="var(--chart-4)"
                    radius={[3, 3, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Skeleton className="h-[220px]" />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Logs d&apos;accès récents</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Heure</TableHead>
                <TableHead>Méthode</TableHead>
                <TableHead>Path</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right">Durée</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((l, i) => (
                <TableRow key={`${l.timestamp}-${i}`}>
                  <TableCell className="metric-mono text-muted-foreground text-xs">
                    {fmtTime(l.timestamp)}
                  </TableCell>
                  <TableCell className="metric-mono font-medium">{l.method}</TableCell>
                  <TableCell className="metric-mono max-w-xs truncate text-xs">{l.path}</TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        l.status == null
                          ? "bg-secondary text-secondary-foreground"
                          : l.status < 300
                            ? "bg-primary/10 text-primary"
                            : l.status < 500
                              ? "bg-chart-4/10 text-chart-4"
                              : "bg-destructive/10 text-destructive"
                      }`}
                    >
                      {l.status ?? "—"}
                    </span>
                  </TableCell>
                  <TableCell className="metric-mono text-right text-xs">
                    {l.duration_ms == null ? "—" : `${l.duration_ms} ms`}
                  </TableCell>
                </TableRow>
              ))}
              {logs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground text-center">
                    Aucun log
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

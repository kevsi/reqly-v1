"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  Play,
  Zap,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
  Globe,
  ListFilter,
  BarChart2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useRequestStore, type HistoryItem } from "@/hooks/use-request-store";
import { useTranslation } from "react-i18next";

const ChartsContent = dynamic(() => import("./charts-content"), { ssr: false });

const METHOD_COLORS: Record<string, string> = {
  GET: "#22c55e",
  POST: "#3b82f6",
  PUT: "#f59e0b",
  DELETE: "#ef4444",
  PATCH: "#8b5cf6",
  OPTIONS: "#6b7280",
  HEAD: "#06b6d4",
};

const METHOD_BADGE: Record<string, string> = {
  GET: "bg-success/10 text-success",
  POST: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
  PUT: "bg-warning/10 text-warning",
  DELETE: "bg-destructive/10 text-destructive",
  PATCH: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400",
  OPTIONS: "bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-400",
  HEAD: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-400",
  TRACE: "bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-400",
};

const STATUS_COLOR = (status: number) => {
  if (status >= 500) return "text-destructive";
  if (status >= 400) return "text-warning";
  if (status >= 300) return "text-sky-500";
  return "text-success";
};

type TimeRange = "7d" | "30d" | "all";

const RANGE_OPTIONS: { value: TimeRange; labelKey: string }[] = [
  { value: "7d", labelKey: "dashboard.range7d" },
  { value: "30d", labelKey: "dashboard.range30d" },
  { value: "all", labelKey: "dashboard.rangeAll" },
];

const formatDayLabel = (date: Date) => `${date.getDate()}/${date.getMonth() + 1}`;

function buildDayBuckets(days: number) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (days - 1 - index));
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return {
      key: `${yyyy}-${mm}-${dd}`,
      label: formatDayLabel(date),
      count: 0,
      errors: 0,
      avgTime: 0,
    };
  });
}

const buildRecentRequests = (
  history: HistoryItem[],
  t: (key: string, options?: Record<string, unknown>) => string,
  limit?: number,
) => {
  const sorted = [...history].sort((a, b) => b.executedAt - a.executedAt);
  const sliced = limit != null ? sorted.slice(0, limit) : sorted;
  return sliced.map((request) => ({
    method: request.method,
    endpoint: request.endpoint || request.url,
    status: request.responseStatus ?? 0,
    time: request.responseTime != null ? `${request.responseTime}ms` : "-",
    timestamp: request.executedAt
      ? t("dashboard.mAgo", {
          minutes: Math.max(1, Math.round((Date.now() - request.executedAt) / 60000)),
        })
      : "-",
  }));
};

const buildTopSlowEndpoints = (
  history: HistoryItem[],
  t: (key: string, options?: Record<string, unknown>) => string,
) => {
  const stats = history.reduce<
    Record<string, { totalTime: number; count: number; lastStatus: number }>
  >((acc, item) => {
    const endpoint = item.endpoint || item.url || t("dashboard.unknown");
    if (item.responseTime == null) return acc;
    const existing = acc[endpoint] ?? { totalTime: 0, count: 0, lastStatus: 0 };
    existing.totalTime += item.responseTime;
    existing.count += 1;
    existing.lastStatus = item.responseStatus ?? existing.lastStatus;
    acc[endpoint] = existing;
    return acc;
  }, {});

  return Object.entries(stats)
    .map(([endpoint, data]) => ({
      endpoint,
      requests: data.count,
      avgTime: Math.round(data.totalTime / data.count),
      status: data.lastStatus >= 500 ? "critical" : data.lastStatus >= 400 ? "warning" : "healthy",
    }))
    .sort((a, b) => b.avgTime - a.avgTime)
    .slice(0, 8);
};

const buildMethodData = (history: HistoryItem[]) => {
  const counts: Record<string, number> = {};
  history.forEach((item) => {
    const m = item.method || "GET";
    counts[m] = (counts[m] ?? 0) + 1;
  });
  return Object.entries(counts)
    .map(([method, count]) => ({ method, count, color: METHOD_COLORS[method] ?? "#6b7280" }))
    .sort((a, b) => b.count - a.count);
};

const buildStatusData = (history: HistoryItem[]) => {
  const buckets: Record<string, number> = { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0, Other: 0 };
  history.forEach((item) => {
    const s = item.responseStatus ?? 0;
    if (s >= 200 && s < 300) buckets["2xx"]++;
    else if (s >= 300 && s < 400) buckets["3xx"]++;
    else if (s >= 400 && s < 500) buckets["4xx"]++;
    else if (s >= 500) buckets["5xx"]++;
    else if (s > 0) buckets["Other"]++;
  });
  const colors: Record<string, string> = {
    "2xx": "#22c55e",
    "3xx": "#06b6d4",
    "4xx": "#f59e0b",
    "5xx": "#ef4444",
    Other: "#6b7280",
  };
  return Object.entries(buckets)
    .filter(([, v]) => v > 0)
    .map(([range, count]) => ({ range, count, color: colors[range] }));
};

export default function DashboardPage() {
  const { history } = useRequestStore();
  const { t } = useTranslation();
  const [isSlowEndpointsOpen, setIsSlowEndpointsOpen] = useState(false);
  const [isRecentRequestsOpen, setIsRecentRequestsOpen] = useState(false);
  const [timeRange, setTimeRange] = useState<TimeRange>("7d");
  // Captured once on mount (React purity rule: no impure calls during render).
  const [now] = useState(() => Date.now());

  const filteredHistory = useMemo(() => {
    if (timeRange === "all") return history;
    const cutoff = now - (timeRange === "7d" ? 7 : 30) * 24 * 60 * 60 * 1000;
    return history.filter((item) => (item.executedAt || item.createdAt || 0) >= cutoff);
  }, [history, timeRange, now]);

  const recentRequests = useMemo(
    () => buildRecentRequests(filteredHistory, t, 10),
    [filteredHistory, t],
  );
  const allRequests = useMemo(() => buildRecentRequests(filteredHistory, t), [filteredHistory, t]);
  const [reqPage, setReqPage] = useState(0);
  const REQ_PAGE_SIZE = 50;

  const stats = useMemo(() => {
    const totalRequests = filteredHistory.length;
    const successfulRequests = filteredHistory.filter(
      (item) => item.responseStatus != null && item.responseStatus < 400,
    ).length;
    const avgResponseTime = filteredHistory.length
      ? Math.round(
          filteredHistory.reduce((sum, item) => sum + (item.responseTime ?? 0), 0) /
            filteredHistory.length,
        )
      : 0;
    const activeEndpoints = new Set(filteredHistory.map((item) => item.endpoint || item.url)).size;
    const successRate = totalRequests
      ? +((successfulRequests / totalRequests) * 100).toFixed(1)
      : 0;
    const errorCount = filteredHistory.filter(
      (item) => item.responseStatus != null && item.responseStatus >= 400,
    ).length;

    return [
      {
        title: t("dashboard.totalRequests"),
        value: totalRequests.toLocaleString(),
        sub: t("dashboard.errorsSub", { count: errorCount }),
        trend: "up",
        icon: Activity,
        accent: "from-success/15 to-transparent",
        iconColor: "text-success",
        iconBg: "bg-success/10",
      },
      {
        title: t("dashboard.avgResponseTime"),
        value: `${avgResponseTime}ms`,
        sub:
          avgResponseTime < 200
            ? t("dashboard.fast")
            : avgResponseTime < 1000
              ? t("dashboard.moderate")
              : t("dashboard.slow"),
        trend: avgResponseTime < 1000 ? "up" : "down",
        icon: Clock,
        accent: "from-violet-500/15 to-transparent",
        iconColor: "text-violet-500",
        iconBg: "bg-violet-500/10",
      },
      {
        title: t("dashboard.successRate"),
        value: `${successRate}%`,
        sub: t("dashboard.successfulSub", { count: successfulRequests }),
        trend: successRate >= 90 ? "up" : "down",
        icon: CheckCircle2,
        accent: "from-sky-500/15 to-transparent",
        iconColor: "text-sky-500",
        iconBg: "bg-sky-500/10",
      },
      {
        title: t("dashboard.activeEndpoints"),
        value: activeEndpoints.toString(),
        sub: t("dashboard.uniqueUrls"),
        trend: "up",
        icon: Globe,
        accent: "from-warning/15 to-transparent",
        iconColor: "text-warning",
        iconBg: "bg-warning/10",
      },
    ];
  }, [filteredHistory, t]);

  const requestsByDay = useMemo(() => {
    const days = timeRange === "7d" ? 7 : timeRange === "30d" ? 30 : 30;
    const buckets = buildDayBuckets(days);
    const indexByKey = Object.fromEntries(buckets.map((bucket, index) => [bucket.key, index]));
    filteredHistory.forEach((item) => {
      const executed = new Date(item.executedAt || item.createdAt || 0);
      const yyyy = executed.getFullYear();
      const mm = String(executed.getMonth() + 1).padStart(2, "0");
      const dd = String(executed.getDate()).padStart(2, "0");
      const key = `${yyyy}-${mm}-${dd}`;
      const bucketIndex = indexByKey[key];
      if (bucketIndex === undefined) return;
      buckets[bucketIndex].count += 1;
      if (item.responseStatus != null && item.responseStatus >= 400) {
        buckets[bucketIndex].errors += 1;
      }
      buckets[bucketIndex].avgTime += item.responseTime ?? 0;
    });
    return buckets.map((bucket) => ({
      label: bucket.label,
      requests: bucket.count,
      errorRate: bucket.count ? +((bucket.errors / bucket.count) * 100).toFixed(1) : 0,
      avgTime: bucket.count ? Math.round(bucket.avgTime / bucket.count) : 0,
    }));
  }, [filteredHistory, timeRange]);

  const topSlowEndpoints = useMemo(
    () => buildTopSlowEndpoints(filteredHistory, t),
    [filteredHistory, t],
  );
  const methodData = useMemo(() => buildMethodData(filteredHistory), [filteredHistory]);
  const statusData = useMemo(() => buildStatusData(filteredHistory), [filteredHistory]);

  const healthCounts = useMemo(() => {
    const latestByEndpoint = new Map<string, HistoryItem>();
    filteredHistory.forEach((item) => {
      const key = item.endpoint || item.url || t("dashboard.unknown");
      const existing = latestByEndpoint.get(key);
      if (!existing || item.executedAt > existing.executedAt) latestByEndpoint.set(key, item);
    });
    let healthy = 0,
      warning = 0,
      critical = 0;
    latestByEndpoint.forEach((item) => {
      if (item.responseStatus == null || item.responseStatus < 400) healthy += 1;
      else if (item.responseStatus < 500) warning += 1;
      else critical += 1;
    });
    return { healthy, warning, critical };
  }, [filteredHistory, t]);

  const totalEndpoints = healthCounts.healthy + healthCounts.warning + healthCounts.critical || 1;
  const isEmpty = history.length === 0;

  return (
    <>
      <main className="flex-1 overflow-auto p-6 hide-scrollbar">
        {/* Header */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-fade-in">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {t("dashboard.title")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {isEmpty
                ? t("dashboard.headerEmpty")
                : t("dashboard.headerMonitoring", {
                    count: filteredHistory.length,
                    total: new Set(filteredHistory.map((h) => h.endpoint || h.url)).size,
                  })}
            </p>
          </div>
          {!isEmpty && (
            <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/30 p-0.5">
              {RANGE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setTimeRange(opt.value)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                    timeRange === opt.value
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t(opt.labelKey)}
                </button>
              ))}
            </div>
          )}
        </div>

        {isEmpty ? (
          <div className="flex flex-col items-center justify-center py-24 text-center animate-slide-up">
            <div className="mb-6 flex size-20 items-center justify-center rounded-full bg-muted">
              <Activity className="size-10 text-muted-foreground/40" />
            </div>
            <h2 className="text-xl font-semibold text-foreground">{t("dashboard.emptyTitle")}</h2>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              {t("dashboard.emptyDescription")}
            </p>
            <a
              href="/"
              className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
            >
              <Play className="size-4" />
              {t("dashboard.goToApi")}
            </a>
          </div>
        ) : (
          <div className="space-y-6">
            {/* ── Row 1: Stat cards ── */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {stats.map((stat, idx) => (
                <Card
                  key={stat.title}
                  className="bg-card overflow-hidden relative animate-slide-up"
                  style={{ animationDelay: `${idx * 40}ms` }}
                >
                  {/* accent gradient */}
                  <div
                    className={cn(
                      "absolute inset-x-0 top-0 h-16 bg-gradient-to-b",
                      stat.accent,
                      "pointer-events-none",
                    )}
                  />
                  <CardHeader className="flex flex-row items-center justify-between pb-1 relative">
                    <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      {stat.title}
                    </CardTitle>
                    <div
                      className={cn(
                        "flex size-8 items-center justify-center rounded-lg",
                        stat.iconBg,
                      )}
                    >
                      <stat.icon className={cn("size-4", stat.iconColor)} />
                    </div>
                  </CardHeader>
                  <CardContent className="relative">
                    <div className="text-2xl font-bold text-foreground">{stat.value}</div>
                    <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                      {stat.trend === "up" ? (
                        <ArrowUpRight className="size-3 text-success shrink-0" />
                      ) : (
                        <ArrowDownRight className="size-3 text-destructive shrink-0" />
                      )}
                      <span>{stat.sub}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* ── Row 2: Charts ── */}
            <ChartsContent data={requestsByDay} methodData={methodData} statusData={statusData} />

            {/* ── Row 3: Recent Requests + Slowest Endpoints ── */}
            <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
              {/* Recent Requests */}
              <Card className="bg-card">
                <CardHeader className="flex flex-row items-center justify-between pb-3">
                  <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <ListFilter className="size-4 text-muted-foreground" />
                    {t("dashboard.recentRequests")}
                  </CardTitle>
                  <button
                    className="text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                    onClick={() => setIsRecentRequestsOpen(true)}
                  >
                    {t("dashboard.viewAll")}
                  </button>
                </CardHeader>
                <CardContent className="p-0">
                  {/* Table header */}
                  <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
                    <div className="grid grid-cols-[80px_1fr_60px_80px_80px] gap-2 px-6 py-2.5 border-b border-border bg-muted/40 min-w-[500px]">
                      <span className="text-[11px] font-semibold text-muted-foreground/80 uppercase tracking-wider flex items-center gap-1.5">
                        <span className="size-1 rounded-full bg-muted-foreground/30" />
                        {t("dashboard.method")}
                      </span>
                      <span className="text-[11px] font-semibold text-muted-foreground/80 uppercase tracking-wider flex items-center gap-1.5">
                        <span className="size-1 rounded-full bg-muted-foreground/30" />
                        {t("dashboard.endpoint")}
                      </span>
                      <span className="text-[11px] font-semibold text-muted-foreground/80 uppercase tracking-wider text-center">
                        {t("dashboard.status")}
                      </span>
                      <span className="text-[11px] font-semibold text-muted-foreground/80 uppercase tracking-wider text-right flex items-center justify-end gap-1.5">
                        <Clock className="size-3" />
                        {t("dashboard.time")}
                      </span>
                      <span className="text-[11px] font-semibold text-muted-foreground/80 uppercase tracking-wider text-right">
                        {t("dashboard.when")}
                      </span>
                    </div>
                    <div className="divide-y divide-border/60">
                      {recentRequests.map((request, idx) => (
                        <div
                          key={request.endpoint + request.timestamp}
                          className={cn(
                            "grid grid-cols-[80px_1fr_60px_80px_80px] gap-2 px-6 py-3 items-center transition-all duration-150 min-w-[500px]",
                            idx % 2 === 0 ? "bg-background" : "bg-muted/10",
                            "hover:bg-muted/30 hover:shadow-sm hover:-translate-y-[1px] active:translate-y-0",
                          )}
                        >
                          <span
                            className={cn(
                              "inline-flex w-fit rounded px-2 py-0.5 text-[10px] font-bold",
                              METHOD_BADGE[request.method] ??
                                "bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-400",
                            )}
                          >
                            {request.method}
                          </span>
                          <span className="font-mono text-xs text-foreground truncate flex items-center gap-1.5">
                            <span className="size-1 rounded-full bg-muted-foreground/20 shrink-0" />
                            {request.endpoint}
                          </span>
                          <span
                            className={cn(
                              "text-xs font-semibold text-center",
                              STATUS_COLOR(request.status),
                            )}
                          >
                            {request.status || "—"}
                          </span>
                          <span className="text-xs text-muted-foreground text-right font-mono">
                            {request.time}
                          </span>
                          <span className="text-xs text-muted-foreground text-right">
                            {request.timestamp}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Slowest Endpoints */}
              <Card className="bg-card">
                <CardHeader className="flex flex-row items-center justify-between pb-3">
                  <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <Zap className="size-4 text-warning" />
                    {t("dashboard.slowestEndpoints")}
                  </CardTitle>
                  <button
                    className="text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                    onClick={() => setIsSlowEndpointsOpen(true)}
                  >
                    {t("dashboard.viewAll")}
                  </button>
                </CardHeader>
                <CardContent className="space-y-2">
                  {topSlowEndpoints.map((endpoint, index) => {
                    const maxTime = topSlowEndpoints[0]?.avgTime || 1;
                    const pct = Math.round((endpoint.avgTime / maxTime) * 100);
                    return (
                      <div key={endpoint.endpoint} className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-xs text-muted-foreground font-mono shrink-0 w-5 text-right">
                              {index + 1}.
                            </span>
                            <p className="text-xs font-medium text-foreground truncate">
                              {endpoint.endpoint}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span
                              className={cn(
                                "text-[10px] font-semibold px-1.5 py-0.5 rounded-full",
                                endpoint.status === "healthy"
                                  ? "bg-success/10 text-success"
                                  : endpoint.status === "warning"
                                    ? "bg-warning/10 text-warning"
                                    : "bg-destructive/10 text-destructive",
                              )}
                            >
                              {endpoint.status === "healthy"
                                ? t("dashboard.healthyStatus")
                                : endpoint.status === "warning"
                                  ? t("dashboard.warningStatus")
                                  : t("dashboard.criticalStatus")}
                            </span>
                            <span className="text-xs font-bold text-foreground w-16 text-right">
                              {endpoint.avgTime}ms
                            </span>
                          </div>
                        </div>
                        <div className="metric-bar ml-7">
                          <div
                            className="metric-bar-fill"
                            style={{
                              width: `${pct}%`,
                              background:
                                endpoint.status === "healthy"
                                  ? "#22c55e"
                                  : endpoint.status === "warning"
                                    ? "#f59e0b"
                                    : "#ef4444",
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </div>

            {/* ── Row 4: Health Overview ── */}
            <Card className="bg-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <BarChart2 className="size-4 text-muted-foreground" />
                  {t("dashboard.apiHealth")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-3">
                  {/* Healthy */}
                  <div className="relative overflow-hidden rounded-xl border border-border bg-gradient-to-br from-success/15 to-transparent p-5">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-3xl font-bold text-foreground">{healthCounts.healthy}</p>
                        <p className="text-sm text-muted-foreground mt-1">
                          {t("dashboard.healthyEndpoints")}
                        </p>
                      </div>
                      <div className="flex size-10 items-center justify-center rounded-full bg-success/15">
                        <CheckCircle2 className="size-5 text-success" />
                      </div>
                    </div>
                    {/* Progress bar */}
                    <div className="mt-4 h-1.5 rounded-full bg-success/20 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-success transition-all duration-700"
                        style={{ width: `${(healthCounts.healthy / totalEndpoints) * 100}%` }}
                      />
                    </div>
                    <p className="mt-1.5 text-xs text-muted-foreground text-right">
                      {t("dashboard.percentOfEndpoints", {
                        percent: Math.round((healthCounts.healthy / totalEndpoints) * 100),
                      })}
                    </p>
                  </div>

                  {/* Warning */}
                  <div className="relative overflow-hidden rounded-xl border border-border bg-gradient-to-br from-warning/15 to-transparent p-5">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-3xl font-bold text-foreground">{healthCounts.warning}</p>
                        <p className="text-sm text-muted-foreground mt-1">
                          {t("dashboard.warningEndpoints")}
                        </p>
                      </div>
                      <div className="flex size-10 items-center justify-center rounded-full bg-warning/15">
                        <AlertTriangle className="size-5 text-warning" />
                      </div>
                    </div>
                    <div className="mt-4 h-1.5 rounded-full bg-warning/20 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-warning transition-all duration-700"
                        style={{ width: `${(healthCounts.warning / totalEndpoints) * 100}%` }}
                      />
                    </div>
                    <p className="mt-1.5 text-xs text-muted-foreground text-right">
                      {t("dashboard.percentOfEndpoints", {
                        percent: Math.round((healthCounts.warning / totalEndpoints) * 100),
                      })}
                    </p>
                  </div>

                  {/* Critical */}
                  <div className="relative overflow-hidden rounded-xl border border-border bg-gradient-to-br from-destructive/15 to-transparent p-5">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-3xl font-bold text-foreground">
                          {healthCounts.critical}
                        </p>
                        <p className="text-sm text-muted-foreground mt-1">
                          {t("dashboard.criticalEndpoints")}
                        </p>
                      </div>
                      <div className="flex size-10 items-center justify-center rounded-full bg-destructive/15">
                        <TrendingUp className="size-5 text-destructive" />
                      </div>
                    </div>
                    <div className="mt-4 h-1.5 rounded-full bg-destructive/20 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-destructive transition-all duration-700"
                        style={{ width: `${(healthCounts.critical / totalEndpoints) * 100}%` }}
                      />
                    </div>
                    <p className="mt-1.5 text-xs text-muted-foreground text-right">
                      {t("dashboard.percentOfEndpoints", {
                        percent: Math.round((healthCounts.critical / totalEndpoints) * 100),
                      })}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </main>

      {/* Modals */}
      <Dialog open={isSlowEndpointsOpen} onOpenChange={setIsSlowEndpointsOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col gap-0 p-0">
          <DialogHeader className="border-b px-6 py-4 shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Zap className="size-4 text-warning" />
              {t("dashboard.slowestEndpoints")}
            </DialogTitle>
          </DialogHeader>
          <div className="overflow-auto p-6 space-y-3">
            {topSlowEndpoints.map((endpoint, index) => {
              const maxTime = topSlowEndpoints[0]?.avgTime || 1;
              const pct = Math.round((endpoint.avgTime / maxTime) * 100);
              return (
                <div
                  key={endpoint.endpoint}
                  className="rounded-lg border border-border bg-muted/30 p-4 space-y-2"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-sm text-muted-foreground font-mono shrink-0">
                        {index + 1}.
                      </span>
                      <div className="min-w-0">
                        <p className="font-medium text-foreground text-sm truncate">
                          {endpoint.endpoint}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {t("dashboard.requestsSub", { count: endpoint.requests })}
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-base font-bold text-foreground">{endpoint.avgTime}ms</p>
                      <span
                        className={cn(
                          "text-[10px] font-semibold px-2 py-0.5 rounded-full",
                          endpoint.status === "healthy"
                            ? "bg-success/10 text-success"
                            : endpoint.status === "warning"
                              ? "bg-warning/10 text-warning"
                              : "bg-destructive/10 text-destructive",
                        )}
                      >
                        {endpoint.status === "healthy"
                          ? t("dashboard.healthyStatus")
                          : endpoint.status === "warning"
                            ? t("dashboard.warningStatus")
                            : t("dashboard.criticalStatus")}
                      </span>
                    </div>
                  </div>
                  <div className="metric-bar">
                    <div
                      className="metric-bar-fill"
                      style={{
                        width: `${pct}%`,
                        background:
                          endpoint.status === "healthy"
                            ? "#22c55e"
                            : endpoint.status === "warning"
                              ? "#f59e0b"
                              : "#ef4444",
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isRecentRequestsOpen}
        onOpenChange={(open) => {
          setIsRecentRequestsOpen(open);
          if (open) setReqPage(0);
        }}
      >
        <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col gap-0 p-0">
          <DialogHeader className="border-b px-6 py-4 shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <ListFilter className="size-4 text-muted-foreground" />
              {t("dashboard.recentRequests")}
              <span className="text-xs font-normal text-muted-foreground">
                {t("dashboard.totalSub", { count: allRequests.length })}
              </span>
            </DialogTitle>
          </DialogHeader>
          <div className="overflow-x-auto">
            <div className="grid grid-cols-[80px_1fr_60px_80px_80px] gap-2 px-6 py-2 border-b border-border bg-muted/30 sticky top-0 min-w-[500px]">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {t("dashboard.method")}
              </span>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {t("dashboard.endpoint")}
              </span>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide text-center">
                {t("dashboard.status")}
              </span>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide text-right">
                {t("dashboard.time")}
              </span>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide text-right">
                {t("dashboard.when")}
              </span>
            </div>
            <div className="divide-y divide-border">
              {allRequests
                .slice(reqPage * REQ_PAGE_SIZE, (reqPage + 1) * REQ_PAGE_SIZE)
                .map((request, i) => (
                  <div
                    key={`${request.endpoint}-${request.timestamp}-${i}`}
                    className="grid grid-cols-[80px_1fr_60px_80px_80px] gap-2 px-6 py-3 items-center hover:bg-muted/20 transition-colors min-w-[500px]"
                  >
                    <span
                      className={cn(
                        "inline-flex w-fit rounded px-2 py-0.5 text-[10px] font-bold",
                        METHOD_BADGE[request.method] ??
                          "bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-400",
                      )}
                    >
                      {request.method}
                    </span>
                    <span className="font-mono text-xs text-foreground truncate min-w-0">
                      {request.endpoint}
                    </span>
                    <span
                      className={cn(
                        "text-xs font-semibold text-center",
                        STATUS_COLOR(request.status),
                      )}
                    >
                      {request.status || "—"}
                    </span>
                    <span className="text-xs text-muted-foreground text-right">{request.time}</span>
                    <span className="text-xs text-muted-foreground text-right">
                      {request.timestamp}
                    </span>
                  </div>
                ))}
            </div>
          </div>
          {allRequests.length > REQ_PAGE_SIZE && (
            <div className="flex items-center justify-between border-t px-6 py-3 shrink-0">
              <span className="text-xs text-muted-foreground">
                {t("dashboard.pageOf", {
                  current: reqPage + 1,
                  total: Math.ceil(allRequests.length / REQ_PAGE_SIZE),
                })}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={reqPage === 0}
                  onClick={() => setReqPage((p) => p - 1)}
                >
                  {t("dashboard.previous")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={(reqPage + 1) * REQ_PAGE_SIZE >= allRequests.length}
                  onClick={() => setReqPage((p) => p + 1)}
                >
                  {t("dashboard.next")}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

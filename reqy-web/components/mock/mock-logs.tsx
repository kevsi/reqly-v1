"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Radio, Terminal, X } from "lucide-react";
import type { MockAdminSettings, MockLogEntry } from "@/lib/mock/admin-client";
import { fetchMockLogs } from "@/lib/mock/admin-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { methodBadgeClass, statusBadgeClass } from "./mock-utils";
import { LogsToolbar, type LogStatusFilter } from "./logs-toolbar";

const K = {
  title: "mocks.logs.title",
  notAttached: "mocks.logs.notAttached",
  total: "mocks.logs.total",
  colTime: "mocks.logs.colTime",
  colMethod: "mocks.logs.colMethod",
  colPath: "mocks.logs.colPath",
  colStatus: "mocks.logs.colStatus",
  colDuration: "mocks.logs.colDuration",
  colMatched: "mocks.logs.colMatched",
  colNote: "mocks.logs.colNote",
  unmatched: "mocks.logs.unmatched",
  empty: "mocks.logs.empty",
  loading: "mocks.logs.loading",
  show: "mocks.layout.showLogs",
  hide: "mocks.layout.hideLogs",
} as const;

interface MockLogsProps {
  settings: MockAdminSettings | null;
  attached: boolean;
  /** Master kill-switch (status bar). When off, no network polling at all. */
  pollingActive: boolean;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

function formatClock(at: number): string {
  const d = new Date(at);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function statusBucket(status: number | null): LogStatusFilter {
  if (status == null) return "network";
  if (status < 300) return "2xx";
  if (status < 400) return "3xx";
  if (status < 500) return "4xx";
  return "5xx";
}

export function MockLogs({
  settings,
  attached,
  pollingActive,
  collapsed,
  onToggleCollapsed,
}: MockLogsProps) {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<MockLogEntry[]>([]);
  const [query, setQuery] = useState("");
  const [statuses, setStatuses] = useState<Set<LogStatusFilter>>(new Set());
  const [unmatchedOnly, setUnmatchedOnly] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [viewPaused, setViewPaused] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const displayedMaxAtRef = useRef(0);
  const viewPausedRef = useRef(false);

  useEffect(() => {
    viewPausedRef.current = viewPaused;
  }, [viewPaused]);

  // Poll the admin channel. While the view is paused we keep counting fresh
  // entries (+N badge) but freeze the visible table.
  useEffect(() => {
    if (!settings || !attached || !pollingActive) return;
    let cancelled = false;
    async function tick() {
      if (!settings) return;
      const entries = await fetchMockLogs(settings);
      if (cancelled) return;
      if (!entries) {
        setFetchFailed(true);
        setLoadedOnce(true);
        return;
      }
      setFetchFailed(false);
      setLoadedOnce(true);
      if (viewPausedRef.current) {
        const fresh = entries.reduce(
          (acc, e) => acc + (e.at > displayedMaxAtRef.current ? 1 : 0),
          0,
        );
        setPendingCount(fresh);
      } else {
        setLogs(entries);
        setPendingCount(0);
        displayedMaxAtRef.current = entries.reduce((max, e) => Math.max(max, e.at), 0);
      }
    }
    void tick();
    const handle = window.setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [settings, attached, pollingActive]);

  useEffect(() => {
    if (!settings || !attached) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- detach clears the local view
      setLogs([]);
      setPendingCount(0);
      setLoadedOnce(false);
      displayedMaxAtRef.current = 0;
    }
  }, [settings, attached]);

  // Auto-scroll to bottom while locked.
  useEffect(() => {
    if (autoScroll && scrollRef.current && !viewPaused) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll, viewPaused]);

  const resumeView = useCallback(() => {
    setViewPaused(false);
    setPendingCount(0);
  }, []);

  const counts = useMemo(() => {
    const out: Record<LogStatusFilter, number> = {
      "2xx": 0,
      "3xx": 0,
      "4xx": 0,
      "5xx": 0,
      network: 0,
    };
    for (const entry of logs) out[statusBucket(entry.responseStatus)] += 1;
    return out;
  }, [logs]);

  const unmatchedCount = useMemo(
    () => logs.reduce((acc, e) => acc + (e.matchedRouteId === null ? 1 : 0), 0),
    [logs],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return logs.filter((entry) => {
      if (statuses.size > 0 && !statuses.has(statusBucket(entry.responseStatus))) return false;
      if (unmatchedOnly && entry.matchedRouteId !== null) return false;
      if (!q) return true;
      return `${entry.method} ${entry.url} ${entry.matchedRouteId ?? ""} ${entry.note ?? ""}`
        .toLowerCase()
        .includes(q);
    });
  }, [logs, query, statuses, unmatchedOnly]);

  function exportFiltered() {
    const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "mock-logs.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function clearView() {
    setLogs([]);
    setPendingCount(0);
    displayedMaxAtRef.current = 0;
  }

  function toggleStatus(status: LogStatusFilter) {
    setStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  }

  if (!attached) {
    return (
      <div className="bg-muted/20 text-muted-foreground flex h-full min-h-24 items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-6 text-sm">
        <Terminal aria-hidden="true" className="size-4" />
        {t(K.notAttached, {
          defaultValue: "Connecte-toi à un mock en cours pour voir les logs.",
        })}
      </div>
    );
  }

  return (
    <div className="bg-card flex h-full min-h-0 flex-col overflow-hidden rounded-xl border">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <Radio
            aria-hidden="true"
            className={cn(
              "size-3.5",
              pollingActive && !viewPaused ? "text-emerald-500" : "text-muted-foreground",
            )}
          />
          {t(K.title, { defaultValue: "Logs temps réel" })}
        </p>
        <Badge variant="secondary" className="font-mono text-[10px]">
          {t(K.total, { defaultValue: "{{count}} requêtes", count: filtered.length })}
        </Badge>
        {viewPaused && pendingCount > 0 && (
          <Badge
            variant="outline"
            className="border-primary/40 text-primary font-mono text-[10px]"
            aria-label={`+${pendingCount}`}
          >
            +{pendingCount}
          </Badge>
        )}
        {fetchFailed && (
          <Badge variant="destructive" className="gap-0.5 text-[10px]">
            <X aria-hidden="true" className="size-2.5" />
            HTTP
          </Badge>
        )}
        {onToggleCollapsed && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="ml-auto size-6"
            onClick={onToggleCollapsed}
            aria-expanded={!collapsed}
            aria-label={
              collapsed
                ? t(K.show, { defaultValue: "Afficher les logs" })
                : t(K.hide, { defaultValue: "Masquer les logs" })
            }
            title={
              collapsed
                ? t(K.show, { defaultValue: "Afficher les logs" })
                : t(K.hide, { defaultValue: "Masquer les logs" })
            }
          >
            {collapsed ? (
              <ChevronUp aria-hidden="true" className="size-3.5" />
            ) : (
              <ChevronDown aria-hidden="true" className="size-3.5" />
            )}
          </Button>
        )}
      </div>

      <LogsToolbar
        query={query}
        onQueryChange={setQuery}
        statuses={statuses}
        onToggleStatus={toggleStatus}
        unmatchedOnly={unmatchedOnly}
        onToggleUnmatched={() => setUnmatchedOnly((v) => !v)}
        counts={counts}
        unmatchedCount={unmatchedCount}
        autoScroll={autoScroll}
        onToggleAutoScroll={() => setAutoScroll((v) => !v)}
        paused={viewPaused}
        pendingCount={pendingCount}
        onTogglePause={() => (viewPaused ? resumeView() : setViewPaused(true))}
        onExport={exportFiltered}
        onClear={clearView}
      />

      {!loadedOnce ? (
        <div className="text-muted-foreground flex flex-1 items-center justify-center gap-2 py-8 text-xs">
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          {t(K.loading, { defaultValue: "Chargement des logs…" })}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-1.5 py-8 text-xs">
          <Terminal aria-hidden="true" className="size-5 opacity-60" />
          {t(K.empty, { defaultValue: "Aucune requête pour le moment." })}
        </div>
      ) : (
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto scrollbar-discreet">
          <table className="w-full border-collapse text-xs">
            <thead className="bg-card sticky top-0 z-10">
              <tr className="text-muted-foreground border-b text-left">
                <th className="px-3 py-1.5 font-medium">{t(K.colTime, { defaultValue: "Heure" })}</th>
                <th className="px-2 py-1.5 font-medium">
                  {t(K.colMethod, { defaultValue: "Méthode" })}
                </th>
                <th className="px-2 py-1.5 font-medium">{t(K.colPath, { defaultValue: "Path" })}</th>
                <th className="px-2 py-1.5 font-medium">
                  {t(K.colStatus, { defaultValue: "Statut" })}
                </th>
                <th className="px-2 py-1.5 font-medium">
                  {t(K.colDuration, { defaultValue: "Durée" })}
                </th>
                <th className="px-2 py-1.5 font-medium">
                  {t(K.colMatched, { defaultValue: "Route matchée" })}
                </th>
                <th className="px-3 py-1.5 font-medium">{t(K.colNote, { defaultValue: "Note" })}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => (
                <tr
                  key={entry.id}
                  className="hover:bg-accent/30 border-border/40 h-8 border-b transition-colors duration-150"
                >
                  <td className="text-muted-foreground px-3 py-1 font-mono text-[11px] whitespace-nowrap tabular-nums">
                    {formatClock(entry.at)}
                  </td>
                  <td className="px-2 py-1">
                    <span
                      className={cn(
                        "rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold",
                        methodBadgeClass(entry.method),
                      )}
                    >
                      {entry.method.toUpperCase()}
                    </span>
                  </td>
                  <td className="max-w-56 truncate px-2 py-1 font-mono" title={entry.url}>
                    {entry.url}
                  </td>
                  <td className="px-2 py-1">
                    <span
                      className={cn(
                        "rounded-full border px-1.5 py-0.5 font-mono text-[10px] tabular-nums",
                        statusBadgeClass(entry.responseStatus),
                      )}
                    >
                      {entry.responseStatus ?? "—"}
                    </span>
                  </td>
                  <td className="text-muted-foreground px-2 py-1 font-mono text-[11px] whitespace-nowrap tabular-nums">
                    {entry.durationMs} ms
                  </td>
                  <td
                    className={cn(
                      "max-w-36 truncate px-2 py-1 font-mono text-[11px]",
                      entry.matchedRouteId === null
                        ? "text-destructive/80"
                        : "text-muted-foreground",
                    )}
                    title={entry.matchedRouteId ?? undefined}
                  >
                    {entry.matchedRouteId ?? t(K.unmatched, { defaultValue: "aucune" })}
                  </td>
                  <td
                    className="text-muted-foreground max-w-40 truncate px-3 py-1"
                    title={entry.note ?? undefined}
                  >
                    {entry.note ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

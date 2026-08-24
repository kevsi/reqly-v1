"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play, Radio, Terminal, X } from "lucide-react";
import type { MockAdminSettings, MockLogEntry } from "@/lib/mock/admin-client";
import { fetchMockLogs } from "@/lib/mock/admin-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { methodBadgeClass, statusBadgeClass } from "./mock-utils";

const K = {
  title: "mocks.logs.title",
  notAttached: "mocks.logs.notAttached",
  pause: "mocks.logs.pause",
  resume: "mocks.logs.resume",
  filter: "mocks.logs.filter",
  filterPh: "mocks.logs.filterPlaceholder",
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
} as const;

interface MockLogsProps {
  settings: MockAdminSettings | null;
  attached: boolean;
  pollingActive: boolean;
  onTogglePolling: () => void;
}

function formatClock(at: number): string {
  const d = new Date(at);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function MockLogs({ settings, attached, pollingActive, onTogglePolling }: MockLogsProps) {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<MockLogEntry[]>([]);
  const [query, setQuery] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const pausedRef = useRef(!pollingActive);

  useEffect(() => {
    pausedRef.current = !pollingActive;
  }, [pollingActive]);

  useEffect(() => {
    if (!settings || !attached) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- détachement : on vide l'affichage
      setLogs([]);
      return;
    }
    let cancelled = false;
    async function tick() {
      if (pausedRef.current || !settings) return;
      const entries = await fetchMockLogs(settings);
      if (cancelled) return;
      if (entries) {
        setFetchFailed(false);
        setLogs(entries);
      } else {
        setFetchFailed(true);
      }
    }
    void tick();
    const handle = window.setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [settings, attached]);

  const filtered = query.trim()
    ? logs.filter((entry) =>
        `${entry.method} ${entry.url} ${entry.matchedRouteId ?? ""} ${entry.note ?? ""}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      )
    : logs;

  if (!attached) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed bg-muted/20 px-4 py-8 text-sm text-muted-foreground">
        <Terminal aria-hidden="true" className="size-4" />
        {t(K.notAttached, {
          defaultValue: "Connecte-toi à un mock en cours pour voir les logs.",
        })}
      </div>
    );
  }

  return (
    <div className="flex flex-col rounded-xl border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <Radio
            aria-hidden="true"
            className={cn("size-3.5", pollingActive ? "text-emerald-500" : "text-muted-foreground")}
          />
          {t(K.title, { defaultValue: "Logs temps réel" })}
        </p>
        <Badge variant="secondary" className="font-mono text-[10px]">
          {t(K.total, { defaultValue: "{{count}} requêtes", count: logs.length })}
        </Badge>
        {fetchFailed && (
          <Badge variant="destructive" className="text-[10px]">
            HTTP ✕
          </Badge>
        )}
        <div className="relative ml-auto w-44">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t(K.filterPh, { defaultValue: "Filtrer…" })}
            aria-label={t(K.filter, { defaultValue: "Filtrer les logs" })}
            className="h-7 pr-6 text-xs"
          />
          {query && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute top-1/2 right-0.5 size-5 -translate-y-1/2"
              onClick={() => setQuery("")}
              aria-label={t(K.filter, { defaultValue: "Filtrer les logs" }) + " — ✕"}
            >
              <X aria-hidden="true" className="size-3" />
            </Button>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={onTogglePolling}
          aria-label={
            pollingActive
              ? t(K.pause, { defaultValue: "Pause" })
              : t(K.resume, { defaultValue: "Reprendre" })
          }
        >
          {pollingActive ? (
            <Pause aria-hidden="true" className="size-3.5" />
          ) : (
            <Play aria-hidden="true" className="size-3.5 text-primary" />
          )}
        </Button>
      </div>
      <div className="max-h-72 overflow-auto scrollbar-discreet">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 bg-card">
            <tr className="border-b text-left text-muted-foreground">
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
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                  {t(K.empty, { defaultValue: "Aucune requête pour le moment." })}
                </td>
              </tr>
            ) : (
              filtered.map((entry) => (
                <tr key={entry.id} className="border-border/40 hover:bg-accent/30 border-b">
                  <td className="px-3 py-1.5 font-mono whitespace-nowrap text-muted-foreground">
                    {formatClock(entry.at)}
                  </td>
                  <td className="px-2 py-1.5">
                    <span
                      className={cn(
                        "rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold",
                        methodBadgeClass(entry.method),
                      )}
                    >
                      {entry.method.toUpperCase()}
                    </span>
                  </td>
                  <td className="max-w-56 truncate px-2 py-1.5 font-mono" title={entry.url}>
                    {entry.url}
                  </td>
                  <td className="px-2 py-1.5">
                    <span
                      className={cn(
                        "rounded border px-1.5 py-0.5 font-mono text-[10px]",
                        statusBadgeClass(entry.responseStatus),
                      )}
                    >
                      {entry.responseStatus ?? "—"}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 font-mono whitespace-nowrap text-muted-foreground">
                    {entry.durationMs} ms
                  </td>
                  <td
                    className="max-w-36 truncate px-2 py-1.5 font-mono text-muted-foreground"
                    title={entry.matchedRouteId ?? undefined}
                  >
                    {entry.matchedRouteId ?? t(K.unmatched, { defaultValue: "aucune" })}
                  </td>
                  <td
                    className="max-w-40 truncate px-3 py-1.5 text-muted-foreground"
                    title={entry.note ?? undefined}
                  >
                    {entry.note ?? ""}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

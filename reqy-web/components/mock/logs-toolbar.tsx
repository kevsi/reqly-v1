"use client";

import { ArrowLeftRight, FileJson, Lock, LockOpen, Pause, Play, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

export type LogStatusFilter = "2xx" | "3xx" | "4xx" | "5xx" | "network";

const K = {
  filter: "mocks.logs.filter",
  filterPh: "mocks.logs.filterPlaceholder",
  clearFilter: "mocks.logs.clearFilter",
  pause: "mocks.logs.pause",
  resume: "mocks.logs.resume",
  autoScroll: "mocks.logs.autoScroll",
  exportJson: "mocks.logs.exportJson",
  clear: "mocks.logs.clear",
  networkErrors: "mocks.logs.networkErrors",
  unmatchedChip: "mocks.logs.unmatchedChip",
  statusAria: "mocks.logs.statusFilterAria",
} as const;

const STATUS_ORDER: LogStatusFilter[] = ["2xx", "3xx", "4xx", "5xx", "network"];

const STATUS_CHIP_CLASS: Record<LogStatusFilter, string> = {
  "2xx": "border-emerald-500/40 bg-emerald-500/15 text-emerald-600",
  "3xx": "border-blue-500/40 bg-blue-500/15 text-blue-600",
  "4xx": "border-amber-500/40 bg-amber-500/15 text-amber-600",
  "5xx": "border-red-500/40 bg-red-500/15 text-red-600",
  network: "border-slate-500/40 bg-slate-500/15 text-slate-500",
};

interface LogsToolbarProps {
  query: string;
  onQueryChange: (value: string) => void;
  statuses: ReadonlySet<LogStatusFilter>;
  onToggleStatus: (status: LogStatusFilter) => void;
  unmatchedOnly: boolean;
  onToggleUnmatched: () => void;
  counts: Record<LogStatusFilter, number>;
  unmatchedCount: number;
  autoScroll: boolean;
  onToggleAutoScroll: () => void;
  paused: boolean;
  pendingCount: number;
  onTogglePause: () => void;
  onExport: () => void;
  onClear: () => void;
}

export function LogsToolbar({
  query,
  onQueryChange,
  statuses,
  onToggleStatus,
  unmatchedOnly,
  onToggleUnmatched,
  counts,
  unmatchedCount,
  autoScroll,
  onToggleAutoScroll,
  paused,
  pendingCount,
  onTogglePause,
  onExport,
  onClear,
}: LogsToolbarProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b px-3 py-1.5">
      <div
        className="flex flex-wrap items-center gap-1"
        role="group"
        aria-label={t(K.statusAria, { defaultValue: "Filtrer par statut" })}
      >
        {STATUS_ORDER.map((status) => {
          const active = statuses.has(status);
          const label =
            status === "network"
              ? t(K.networkErrors, { defaultValue: "Erreurs réseau" })
              : status;
          return (
            <button
              key={status}
              type="button"
              onClick={() => onToggleStatus(status)}
              aria-pressed={active}
              title={
                status === "network"
                  ? t(K.networkErrors, { defaultValue: "Erreurs réseau" })
                  : label
              }
              aria-label={label}
              className={cn(
                "flex items-center rounded-full border px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap transition-all duration-150 focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
                active
                  ? STATUS_CHIP_CLASS[status]
                  : "border-border bg-accent/30 text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
              <span className="ml-1 opacity-70">{counts[status]}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={onToggleUnmatched}
          aria-pressed={unmatchedOnly}
          title={t(K.unmatchedChip, { defaultValue: "Non matchées" })}
          aria-label={t(K.unmatchedChip, { defaultValue: "Non matchées" })}
          className={cn(
            "flex items-center rounded-full border px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap transition-all duration-150 focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
            unmatchedOnly
              ? "border-primary/50 bg-primary/15 text-primary"
              : "border-border bg-accent/30 text-muted-foreground hover:text-foreground",
          )}
        >
          <ArrowLeftRight aria-hidden="true" className="size-2.5 shrink-0" />
          <span className="ml-0.5 font-sans">{t(K.unmatchedChip, { defaultValue: "Non matchées" })}</span>
          <span className="ml-1 opacity-70">{unmatchedCount}</span>
        </button>
      </div>

      <div className="relative ml-auto w-36">
        <Input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
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
            onClick={() => onQueryChange("")}
            aria-label={t(K.clearFilter, { defaultValue: "Effacer le filtre" })}
            title={t(K.clearFilter, { defaultValue: "Effacer le filtre" })}
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
        onClick={onToggleAutoScroll}
        aria-pressed={autoScroll}
        aria-label={t(K.autoScroll, { defaultValue: "Défilement auto" })}
        title={t(K.autoScroll, { defaultValue: "Défilement auto" })}
      >
        {autoScroll ? (
          <Lock aria-hidden="true" className="text-primary size-3.5" />
        ) : (
          <LockOpen aria-hidden="true" className="size-3.5" />
        )}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7"
        onClick={onExport}
        aria-label={t(K.exportJson, { defaultValue: "Exporter .json" })}
        title={t(K.exportJson, { defaultValue: "Exporter .json" })}
      >
        <FileJson aria-hidden="true" className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="hover:text-destructive size-7 text-muted-foreground hover:text-destructive"
        onClick={onClear}
        aria-label={t(K.clear, { defaultValue: "Vider" })}
        title={t(K.clear, { defaultValue: "Vider (vue locale)" })}
      >
        <Trash2 aria-hidden="true" className="size-3.5" />
      </Button>

      <div className="relative">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={onTogglePause}
          aria-label={
            paused
              ? t(K.resume, { defaultValue: "Reprendre" })
              : t(K.pause, { defaultValue: "Pause" })
          }
          title={
            paused
              ? t(K.resume, { defaultValue: "Reprendre" })
              : t(K.pause, { defaultValue: "Pause" })
          }
        >
          {paused ? (
            <Play aria-hidden="true" className="text-primary size-3.5" />
          ) : (
            <Pause aria-hidden="true" className="size-3.5" />
          )}
        </Button>
        {paused && pendingCount > 0 && (
          <Badge
            variant="secondary"
            className="absolute -top-2 -right-2 h-4 min-w-4 px-1 py-0 font-mono text-[9px] leading-none"
            aria-label={`+${pendingCount}`}
          >
            +{pendingCount}
          </Badge>
        )}
      </div>
    </div>
  );
}
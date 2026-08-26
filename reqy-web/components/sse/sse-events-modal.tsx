"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, Loader2, Pause, Play, Radio, Trash2, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSSE } from "@/hooks/use-sse";

/**
 * Modal SSE live — observe une connexion Server-Sent Events depuis l'onglet
 * de requête courant. Version sobre : pas de couleurs par type d'event,
 * pas de badges décoratifs, pas d'animations pulsées.
 */

export interface SSEEventTarget {
  url: string;
  headers?: Array<{ key: string; value: string }>;
  authType?: string;
  authToken?: string;
}

interface SSEEventsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: SSEEventTarget | null;
}

const DISPLAY_CAP = 200;
const PRETTY_MAX_CHARS = 4000;

function formatData(data: string): { text: string; isTruncated: boolean } {
  let text = data;
  try {
    text = JSON.stringify(JSON.parse(data), null, 2);
  } catch {
    /* brut */
  }
  if (text.length > PRETTY_MAX_CHARS) {
    return { text: `${text.slice(0, PRETTY_MAX_CHARS)}\n…`, isTruncated: true };
  }
  return { text, isTruncated: false };
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "open":
      return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
    case "connecting":
      return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
    case "error":
      return "bg-destructive/15 text-destructive";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export function SSEEventsModal({ open, onOpenChange, target }: SSEEventsModalProps) {
  const { t } = useTranslation();
  const sse = useSSE();
  const [filter, setFilter] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyUrlTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open || !target?.url) return;
    sse.connect({
      url: target.url,
      headers: target.headers,
      auth:
        target.authType === "bearer" || target.authType === "basic"
          ? { type: target.authType, token: target.authToken ?? "" }
          : undefined,
      autoReconnect: true,
    });
    return () => {
      sse.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const [prevTargetUrl, setPrevTargetUrl] = useState(target?.url);
  if ((target?.url ?? "") !== (prevTargetUrl ?? "")) {
    setPrevTargetUrl(target?.url);
    setExpandedIds(new Set());
    setCopiedId(null);
    setFilter("");
  }

  const visibleEvents = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const filtered = needle
      ? sse.events.filter(
          (e) =>
            e.event.toLowerCase().includes(needle) || e.data.toLowerCase().includes(needle),
        )
      : sse.events;
    return filtered.slice(-DISPLAY_CAP);
  }, [sse.events, filter]);

  const handleCopy = (id: string, data: string) => {
    navigator.clipboard.writeText(data).then(() => {
      setCopiedId(id);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedId(null), 1500);
    }).catch(() => undefined);
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const statusKey =
    sse.status === "idle"
      ? "sse.statusIdle"
      : sse.status === "connecting"
        ? "sse.statusConnecting"
        : sse.status === "open"
          ? "sse.statusOpen"
          : sse.status === "error"
            ? "sse.statusError"
            : "sse.statusClosed";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="sm:max-w-4xl overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Radio className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{t("sse.monitor")}</span>
            <Badge className={`shrink-0 ${statusBadgeClass(sse.status)}`}>
              {sse.status === "connecting" ? (
                <Loader2 className="mr-1 size-3 animate-spin" aria-hidden />
              ) : null}
              {t(statusKey)}
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto size-8 shrink-0 opacity-70 hover:opacity-100"
              onClick={() => onOpenChange(false)}
              aria-label="Close"
            >
              <X className="size-4" aria-hidden />
            </Button>
          </DialogTitle>
        </DialogHeader>

        {/* ── Contrôles ──────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2">
          {sse.status === "open" || sse.status === "connecting" ? (
            <Button size="sm" variant="outline" onClick={sse.disconnect} className="text-xs">
              {t("sse.disconnect")}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() =>
                target && sse.connect({ url: target.url, headers: target.headers })
              }
              disabled={!target?.url}
              className="text-xs"
            >
              {t("sse.connect")}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={sse.togglePause}
            disabled={sse.status !== "open"}
            className="text-xs"
          >
            {sse.isPaused ? (
              <>
                <Play className="mr-1 size-3" aria-hidden /> {t("sse.resume")}
              </>
            ) : (
              <>
                <Pause className="mr-1 size-3" aria-hidden /> {t("sse.pause")}
              </>
            )}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={sse.clearEvents}
            className="text-xs"
            aria-label={t("sse.clear")}
          >
            <Trash2 className="size-3" aria-hidden />
          </Button>
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            {sse.events.length} · {sse.eventsPerSec.toFixed(1)} ev/s
            {sse.isPaused ? ` · ${t("sse.pause")}` : ""}
          </span>
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("sse.eventFilterPlaceholder")}
            className="h-8 min-w-40 flex-1 text-xs sm:max-w-64"
            aria-label={t("sse.eventFilter")}
          />
        </div>

        {/* ── Flux ───────────────────────────────────────────────────── */}
        <ScrollArea className="h-[60vh] max-h-[26rem] rounded-md border">
          <div className="p-2 font-mono text-xs">
            {visibleEvents.length === 0 ? (
              <div className="text-muted-foreground p-6 text-center">
                {sse.status === "open" && !sse.isPaused
                  ? t("sse.noEvents")
                  : `${t("sse.noEvents")} — ${t("sse.errorHint")}`}
              </div>
            ) : (
              [...visibleEvents].reverse().map((e) => {
                const { text, isTruncated } = formatData(e.data);
                const expanded = expandedIds.has(e.id);
                return (
                  <div
                    key={e.id}
                    className="group border-b border-border/40 py-1.5 pl-2 border-l-2 border-border"
                  >
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="tabular-nums">
                        {new Date(e.timestamp).toLocaleTimeString(undefined, {
                          hour12: false,
                        })}
                      </span>
                      <span className="font-medium">{e.event || "message"}</span>
                      <span className="truncate text-muted-foreground/60">id: {e.id}</span>
                      <button
                        type="button"
                        onClick={() => handleCopy(e.id, e.data)}
                        className="ml-auto flex items-center gap-0.5 rounded px-1 hover:bg-accent hover:text-foreground"
                        title={copiedId === e.id ? t("sse.copied") : t("sse.copy")}
                        aria-label={t("sse.copy")}
                      >
                        {copiedId === e.id ? (
                          <Check className="size-3 text-emerald-500" />
                        ) : (
                          <Copy className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
                        )}
                        {copiedId === e.id ? t("sse.copied") : ""}
                      </button>
                    </div>
                    <pre
                      className={`mt-0.5 whitespace-pre-wrap break-all text-foreground/90 ${
                        !expanded && (isTruncated || text.length > 300) ? "line-clamp-3" : ""
                      }`}
                    >
                      {text}
                    </pre>
                    {(isTruncated || text.length > 300) && (
                      <button
                        type="button"
                        onClick={() => toggleExpand(e.id)}
                        className="mt-0.5 text-xs text-muted-foreground hover:underline"
                      >
                        {expanded ? t("sse.showLess") : t("sse.showMore")}
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>

        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground truncate" title={target?.url}>
            {target?.url ?? ""}
          </span>
          {target?.url ? (
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(target.url).catch(() => undefined);
                setCopiedUrl(true);
                if (copyUrlTimerRef.current) clearTimeout(copyUrlTimerRef.current);
                copyUrlTimerRef.current = setTimeout(() => setCopiedUrl(false), 1500);
              }}
              className="ml-auto flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent"
              title={copiedUrl ? t("sse.copied") : t("sse.copy")}
            >
              {copiedUrl ? (
                <Check className="size-3 text-emerald-500" />
              ) : (
                <Copy className="text-muted-foreground size-3" />
              )}
            </button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, Send, Trash2, X, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useWebSocket, type WsStatus } from "@/hooks/use-websocket";
import type { WsTimelineEntry } from "@/lib/websocket-utils";
import { formatBytes, cn } from "@/lib/utils";

/**
 * Modal WebSocket live — échange de messages sur l'URL de la requête
 * courante (pattern du modal SSE). Version sobre : pas d'animations,
 * pas de badges décoratifs.
 */

export interface WsEventTarget {
  url: string;
  headers?: Array<{ key: string; value: string }>;
  authType?: string;
  authToken?: string;
}

interface WebSocketModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: WsEventTarget | null;
}

const DISPLAY_CAP = 200;

function statusBadgeClass(status: WsStatus): string {
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

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function buildTargetHeaders(target: WsEventTarget): Array<[string, string]> {
  const headers: Array<[string, string]> = (target.headers ?? [])
    .filter((h) => h.key.trim())
    .map((h) => [h.key.trim(), h.value] as [string, string]);
  if (
    (target.authType === "bearer" || target.authType === "basic") &&
    target.authToken
  ) {
    headers.push([
      "Authorization",
      target.authType === "bearer" ? `Bearer ${target.authToken}` : `Basic ${target.authToken}`,
    ]);
  }
  return headers;
}

export function WebSocketModal({ open, onOpenChange, target }: WebSocketModalProps) {
  const { t } = useTranslation();
  const ws = useWebSocket();
  const [draft, setDraft] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [prevTargetUrl, setPrevTargetUrl] = useState(target?.url);

  useEffect(() => {
    if (!open || !target?.url) return;
    ws.connect({
      url: target.url,
      headers: buildTargetHeaders(target).map(([key, value]) => ({ key, value })),
    });
    return () => {
      void ws.disconnect(1000, "Client closed the connection.");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if ((target?.url ?? "") !== (prevTargetUrl ?? "")) {
    setPrevTargetUrl(target?.url);
    setDraft("");
    setCopiedId(null);
    setCopiedUrl(false);
  }

  const visibleMessages = useMemo(
    () => ws.messages.slice(-DISPLAY_CAP),
    [ws.messages],
  );

  const handleSend = async () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    await ws.send(trimmed);
    setDraft("");
  };

  const copy = (id: string, data: string) => {
    navigator.clipboard.writeText(data).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    }).catch(() => undefined);
  };

  const copyUrl = () => {
    if (!target?.url) return;
    navigator.clipboard.writeText(target.url).then(() => {
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 1500);
    }).catch(() => undefined);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl h-[80vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2 text-sm">
            {t("websocket.title")}
            <Badge
              variant="outline"
              className={cn("text-[10px] font-semibold", statusBadgeClass(ws.status))}
            >
              {t(
                ws.status === "open"
                  ? "websocket.statusOpen"
                  : ws.status === "connecting"
                    ? "websocket.statusConnecting"
                    : ws.status === "error"
                      ? "websocket.statusError"
                      : "websocket.statusClosed",
              )}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2 shrink-0 rounded-md border border-input/50 bg-muted/20 px-2 py-1">
          <span className="flex-1 text-[11px] font-mono text-muted-foreground truncate">
            {target?.url ?? "—"}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={copyUrl}
            title={t("common.copy")}
          >
            {copiedUrl ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
          </Button>
        </div>

        {ws.error && (
          <div className="shrink-0 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
            {ws.error}
          </div>
        )}

        <ScrollArea className="flex-1 min-h-0 border border-border rounded-md bg-muted/10">
          <div className="flex flex-col gap-1.5 p-2">
            {visibleMessages.length === 0 && (
              <div className="flex flex-col items-center justify-center py-10 text-xs text-muted-foreground/50">
                {t("websocket.noMessages")}
              </div>
            )}
            {visibleMessages.map((entry: WsTimelineEntry) => {
              const isOut = entry.direction === "out";
              return (
                <div
                  key={entry.id}
                  className={cn(
                    "group/msg flex items-start gap-2 rounded-md border px-2 py-1.5 text-xs",
                    isOut ? "border-border/60 bg-muted/20" : "border-primary/20 bg-primary/5",
                  )}
                >
                  <Badge
                    variant="outline"
                    className={cn(
                      "shrink-0 text-[9px] font-mono px-1 py-0 mt-0.5",
                      isOut ? "border-border text-muted-foreground" : "border-primary/30 text-primary",
                    )}
                  >
                    {isOut ? (
                      <ArrowUpRight className="size-2.5" />
                    ) : (
                      <ArrowDownLeft className="size-2.5" />
                    )}
                    {isOut ? t("websocket.sent") : t("websocket.received")}
                  </Badge>
                  <pre className="flex-1 font-mono leading-relaxed whitespace-pre-wrap break-all text-foreground">
                    {entry.kind === "binary" ? `(${formatBytes(entry.byteLen)})` : entry.data}
                  </pre>
                  <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover/msg:opacity-100 transition-opacity">
                    <span className="text-[9px] font-mono text-muted-foreground/40">
                      {formatTimestamp(entry.timestamp)}
                    </span>
                    <button
                      type="button"
                      onClick={() => copy(entry.id, entry.data)}
                      className="text-muted-foreground/60 hover:text-foreground"
                      aria-label={t("common.copy")}
                    >
                      {copiedId === entry.id ? (
                        <Check className="size-3 text-success" />
                      ) : (
                        <Copy className="size-3" />
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>

        <div className="flex items-center gap-1.5 shrink-0">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder={t("websocket.composerPlaceholder")}
            disabled={ws.status !== "open"}
            className="h-8 font-mono text-xs"
          />
          <Button
            size="sm"
            className="h-8"
            onClick={handleSend}
            disabled={ws.status !== "open" || !draft.trim()}
          >
            <Send className="size-3.5" />
            {t("websocket.send")}
          </Button>
          {ws.messages.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-muted-foreground/50 hover:text-destructive"
              onClick={ws.clearMessages}
              title={t("websocket.clear")}
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-muted-foreground/50 hover:text-foreground"
            onClick={() => onOpenChange(false)}
            title={t("common.close")}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

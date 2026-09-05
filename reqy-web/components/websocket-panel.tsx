"use client";

import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { useWebSocket, type WsStatus } from "@/hooks/use-websocket";
import type { WsTimelineEntry } from "@/lib/websocket-utils";
import { KeyValueEditor, type KeyValuePair } from "@/components/key-value-editor";
import { useRequestStore } from "@/hooks/use-request-store";
import { AutocompleteInput, type AutocompleteGroup } from "@/components/ui/autocomplete-input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatBytes, cn } from "@/lib/utils";
import { base64ToHexPreview, isValidJson } from "@/lib/websocket-utils";
import {
  Cable,
  Wifi,
  WifiOff,
  Loader2,
  Trash2,
  Activity,
  ChevronDown,
  ChevronRight,
  FileText,
  Shield,
  AlertCircle,
  Send,
  ArrowDownLeft,
  ArrowUpRight,
} from "lucide-react";
import { useTranslation } from "react-i18next";

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  const ss = d.getSeconds().toString().padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function prettyPrintJson(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return raw;
  }
}

function MessageItem({ entry }: { entry: WsTimelineEntry }) {
  const { t } = useTranslation();
  const isOut = entry.direction === "out";
  const isBinary = entry.kind === "binary";
  const formatted = entry.kind === "text" ? prettyPrintJson(entry.data) : entry.data;

  return (
    <div
      className={cn(
        "group/msg flex flex-col gap-1 rounded-lg border p-3 transition-all duration-200",
        entry.kind === "ping"
          ? "border-warning/20 bg-warning/5"
          : isOut
            ? "border-border/60 bg-muted/20"
            : "border-primary/20 bg-primary/5",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Badge
            variant="outline"
            className={cn(
              "gap-1 text-[10px] font-bold font-mono px-1.5 py-0 shrink-0",
              entry.kind === "ping"
                ? "border-warning/30 text-warning bg-warning/10"
                : isOut
                  ? "border-border text-muted-foreground"
                  : "border-primary/30 text-primary bg-primary/10",
            )}
          >
            {isOut ? (
              <ArrowUpRight className="size-2.5" />
            ) : (
              <ArrowDownLeft className="size-2.5" />
            )}
            {isOut ? t("websocket.sent") : entry.kind === "ping" ? "PING" : t("websocket.received")}
          </Badge>
          {isBinary && (
            <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0 shrink-0">
              {formatBytes(entry.byteLen)}
            </Badge>
          )}
          <span className="text-[10px] font-mono text-muted-foreground/50 shrink-0">
            {formatTimestamp(entry.timestamp)}
          </span>
        </div>
      </div>
      {isBinary ? (
        <pre className="text-[10px] font-mono leading-relaxed text-muted-foreground whitespace-pre-wrap break-all">
          {base64ToHexPreview(entry.data)}
          {entry.byteLen > 64 ? ` … (${formatBytes(entry.byteLen)})` : ""}
        </pre>
      ) : (
        <pre className="text-xs font-mono leading-relaxed text-foreground whitespace-pre-wrap break-all">
          {formatted}
        </pre>
      )}
    </div>
  );
}

export function WebSocketPanel() {
  const { t } = useTranslation();
  const { status, error, messages, bytesIn, bytesOut, connect, send, disconnect, clearMessages } =
    useWebSocket();
  const [url, setUrl] = useState("ws://localhost:3000/ws");
  const [showOptions, setShowOptions] = useState(false);
  const [headers, setHeaders] = useState<KeyValuePair[]>([]);
  const [subprotocols, setSubprotocols] = useState("");
  const [draft, setDraft] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages.length]);

  const environments = useRequestStore((s) => s.environments);
  const activeEnvironmentId = useRequestStore((s) => s.activeEnvironmentId);
  const history = useRequestStore((s) => s.history);
  const envVarNames = useMemo(() => {
    const activeEnv = environments.find((e) => e.id === activeEnvironmentId);
    return (activeEnv?.variables ?? [])
      .filter((v) => v.enabled && v.key.trim())
      .map((v) => v.key.trim());
  }, [environments, activeEnvironmentId]);

  const urlAutocompleteGroups = useMemo((): AutocompleteGroup[] => {
    const groups: AutocompleteGroup[] = [];
    if (envVarNames.length > 0) {
      groups.push({
        label: t("request.variables"),
        items: envVarNames.map((name) => ({
          id: `ws-url-var-${name}`,
          label: `{{${name}}}`,
          value: `{{${name}}}`,
        })),
      });
    }
    const seen = new Set<string>();
    const urlItems: AutocompleteGroup["items"] = [];
    for (const h of history) {
      const u = h.url;
      if (!u || seen.has(u)) continue;
      seen.add(u);
      urlItems.push({ id: `ws-uh-${u}`, label: u, value: u });
    }
    if (urlItems.length > 0) {
      groups.push({ label: t("request.history"), items: urlItems.slice(0, 20) });
    }
    return groups;
  }, [envVarNames, history, t]);

  const varSuggestions = useMemo((): AutocompleteGroup[] => {
    if (envVarNames.length === 0) return [];
    return [
      {
        label: t("request.variables"),
        items: envVarNames.map((name) => ({
          id: `ws-var-${name}`,
          label: `{{${name}}}`,
          value: `{{${name}}}`,
          description: t("websocket.variableDesc"),
        })),
      },
    ];
  }, [envVarNames, t]);

  const handleConnect = useCallback(() => {
    const trimmed = url.trim();
    if (!trimmed) return;
    connect({
      url: trimmed,
      headers,
      subprotocols: subprotocols.trim() || undefined,
    });
  }, [url, headers, subprotocols, connect]);

  const handleDisconnect = useCallback(() => {
    disconnect(1000, "Client closed the connection.");
  }, [disconnect]);

  const handleSend = useCallback(async () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    await send(trimmed);
  }, [draft, send]);

  const statusConfig: Record<WsStatus, { label: string; className: string; icon: React.ReactNode }> =
    {
      idle: {
        label: t("websocket.statusIdle"),
        className: "bg-muted text-muted-foreground",
        icon: <Activity />,
      },
      connecting: {
        label: t("websocket.statusConnecting"),
        className: "bg-warning/10 text-warning border-warning/20",
        icon: <Loader2 className="animate-spin" />,
      },
      open: {
        label: t("websocket.statusOpen"),
        className: "bg-success/10 text-success border-success/20",
        icon: <Wifi />,
      },
      closed: {
        label: t("websocket.statusClosed"),
        className: "bg-muted text-muted-foreground",
        icon: <WifiOff />,
      },
      error: {
        label: t("websocket.statusError"),
        className: "bg-destructive/10 text-destructive border-destructive/20",
        icon: <WifiOff />,
      },
    };

  const currentStatus = statusConfig[status] ?? statusConfig.idle;
  const isConnected = status === "open" || status === "connecting";

  return (
    <div className="flex flex-1 min-w-0 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20">
            <Cable className="size-3.5 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground tracking-tight leading-none">
              {t("websocket.title")}
            </h3>
            <p className="text-[10px] text-muted-foreground/40 leading-none mt-1">
              {t("websocket.monitor")}
            </p>
          </div>
        </div>
      </div>

      {/* Connection Bar */}
      <div className="p-3 pb-1">
        <div className="flex items-center gap-2 rounded-lg border border-input/50 px-3 py-1.5 transition-all duration-200">
          <Badge
            variant="outline"
            className={cn(
              "shrink-0 gap-1.5 py-0.5 px-2 text-[11px] font-semibold",
              currentStatus.className,
            )}
          >
            {currentStatus.icon}
            {currentStatus.label}
          </Badge>

          <div className="relative flex-1">
            <AutocompleteInput
              value={url}
              onChange={setUrl}
              placeholder="ws://localhost:3000/ws"
              disabled={isConnected}
              className="font-mono text-sm h-9"
              suggestions={urlAutocompleteGroups}
              emptyMessage={t("request.noResults")}
            />
          </div>

          {isConnected ? (
            <Button
              variant="outline"
              size="sm"
              disabled={status === "connecting"}
              onClick={handleDisconnect}
              className="shrink-0 border-red-200/40 text-red-600 transition-all duration-150 hover:scale-105 hover:border-red-300/60 hover:bg-red-50 hover:text-red-700 hover:shadow-sm active:scale-95 dark:border-red-800/30 dark:text-red-400 dark:hover:bg-red-950/50"
            >
              <WifiOff className="size-4" />
              {t("websocket.disconnect")}
            </Button>
          ) : (
            <Button
              variant="default"
              size="sm"
              onClick={handleConnect}
              disabled={!url.trim()}
              className="shrink-0 bg-emerald-600 text-white transition-all duration-150 hover:scale-105 hover:bg-emerald-700 hover:shadow-sm active:scale-95 dark:bg-emerald-600 dark:hover:bg-emerald-500"
            >
              <Wifi className="size-4" />
              {t("websocket.connect")}
            </Button>
          )}
        </div>
      </div>

      {/* Error banner */}
      {status === "error" && error && (
        <div className="px-3 pb-1">
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive animate-in slide-in-from-top-1 duration-200">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <span className="font-semibold break-words">{error}</span>
          </div>
        </div>
      )}

      {/* Options Toggle */}
      <div className="px-3 pb-1">
        <button
          type="button"
          onClick={() => setShowOptions(!showOptions)}
          disabled={isConnected}
          className={cn(
            "flex w-full items-center gap-2 rounded-lg border border-input/30 px-3 py-2 text-xs font-medium",
            "text-muted-foreground/60 hover:text-foreground hover:border-input/60",
            "transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed",
          )}
        >
          {showOptions ? (
            <ChevronDown className="size-3.5 shrink-0" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0" />
          )}
          {t("websocket.options")}
          {(headers.length > 0 || subprotocols.trim()) && (
            <span className="ml-auto flex items-center gap-1.5 text-[10px] text-muted-foreground/40">
              {headers.length > 0 && <FileText className="size-3" />}
              {subprotocols.trim() && <Shield className="size-3" />}
            </span>
          )}
        </button>

        {showOptions && (
          <div className="mt-2 space-y-4 rounded-lg border border-input/30 p-3 animate-in slide-in-from-top-1 duration-200">
            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                {t("websocket.customHeaders")}
              </Label>
              <KeyValueEditor
                pairs={headers}
                onChange={setHeaders}
                keyPlaceholder={t("websocket.headerNamePlaceholder")}
                valuePlaceholder={t("websocket.headerValuePlaceholder")}
                addLabel={t("websocket.addHeader")}
                emptyLabel={t("websocket.noCustomHeaders")}
                showToggle
                valueSuggestions={varSuggestions}
              />
            </div>

            <div className="border-t border-border/40" />

            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                {t("websocket.subprotocols")}
              </Label>
              <Input
                type="text"
                value={subprotocols}
                onChange={(e) => setSubprotocols(e.target.value)}
                placeholder="chat, json"
                disabled={isConnected}
                className="h-9 border-input bg-muted/20 text-xs transition-all duration-200 focus:bg-muted/40"
              />
              <p className="text-[10px] text-muted-foreground/40">{t("websocket.subprotocolsHint")}</p>
            </div>
          </div>
        )}
      </div>

      {/* Messages Area */}
      <div className="flex flex-1 min-h-0 flex-col px-3 pb-3">
        <div className="flex items-center justify-between gap-2 mb-2 shrink-0">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50 shrink-0">
            {t("websocket.messages")}
            {messages.length > 0 && (
              <span className="ml-1.5 font-mono text-muted-foreground/30">({messages.length})</span>
            )}
          </span>
          <div className="flex items-center gap-1.5">
            {(bytesIn > 0 || bytesOut > 0) && (
              <span className="text-[10px] font-mono text-muted-foreground/40 truncate">
                ↓ {formatBytes(bytesIn)} · ↑ {formatBytes(bytesOut)}
              </span>
            )}
            {messages.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearMessages}
                className="h-6 gap-1 text-[10px] font-medium text-muted-foreground/50 hover:text-destructive transition-colors duration-200"
              >
                <Trash2 className="size-3" />
                {t("websocket.clear")}
              </Button>
            )}
          </div>
        </div>

        <ScrollArea className="flex-1 min-h-0 border border-border rounded-lg bg-muted/10">
          <div className="flex flex-col gap-2 p-3">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-xs text-muted-foreground/50">
                <Activity className="size-8 mb-2 text-muted-foreground/20" />
                <span>{t("websocket.noMessages")}</span>
                <span className="text-[10px] text-muted-foreground/30 mt-1">
                  {t("websocket.noMessagesHint")}
                </span>
              </div>
            )}
            {messages.map((entry) => (
              <MessageItem key={entry.id} entry={entry} />
            ))}
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        {/* Composer */}
        <div className="mt-2 flex items-end gap-2 shrink-0">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder={t("websocket.composerPlaceholder")}
            disabled={!isConnected || status !== "open"}
            rows={2}
            className="min-h-9 font-mono text-xs resize-none"
          />
          <Button
            size="sm"
            onClick={handleSend}
            disabled={!isConnected || status !== "open" || !draft.trim()}
            className="shrink-0 gap-1.5"
          >
            <Send className="size-3.5" />
            {t("websocket.send")}
            {isValidJson(draft) && (
              <span className="text-[9px] font-mono opacity-60">{t("websocket.jsonBadge")}</span>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

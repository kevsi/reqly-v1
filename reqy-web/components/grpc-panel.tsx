"use client";

import { useState, useCallback, useMemo } from "react";
import {
  grpcListServices,
  grpcCall,
  type GrpcServiceInfo,
  type GrpcCallResult,
} from "@/lib/tauri";
import { AutocompleteInput, type AutocompleteGroup } from "@/components/ui/autocomplete-input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { KeyValueEditor, type KeyValuePair } from "@/components/key-value-editor";
import { useRequestStore } from "@/hooks/use-request-store";
import { cn } from "@/lib/utils";
import {
  Network,
  Loader2,
  AlertCircle,
  Send,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Radio,
} from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * Panneau gRPC — réflexion serveur pour la découverte, appels unary et
 * server-streaming avec payload JSON (DynamicMessage prost-reflect côté
 * Rust). Desktop uniquement : le transport h2 vit dans src-tauri/grpc.rs.
 */

type Status = "idle" | "loading" | "ready" | "error";

export function GrpcPanel() {
  const { t } = useTranslation();
  const [url, setUrl] = useState("http://localhost:50051");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [services, setServices] = useState<GrpcServiceInfo[]>([]);
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);
  const [payload, setPayload] = useState("{}");
  const [metadata, setMetadata] = useState<KeyValuePair[]>([]);
  const [result, setResult] = useState<GrpcCallResult | null>(null);
  const [calling, setCalling] = useState(false);
  const [showMetadata, setShowMetadata] = useState(false);

  const history = useRequestStore((s) => s.history);
  const urlSuggestions = useMemo((): AutocompleteGroup[] => {
    const seen = new Set<string>();
    const items: AutocompleteGroup["items"] = [];
    for (const h of history) {
      const u = h.url;
      if (!u || seen.has(u)) continue;
      seen.add(u);
      items.push({ id: `grpc-h-${u}`, label: u, value: u });
    }
    return items.length ? [{ label: t("request.history"), items: items.slice(0, 10) }] : [];
  }, [history, t]);

  const discover = useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setStatus("loading");
    setError(null);
    setResult(null);
    try {
      const list = await grpcListServices(trimmed);
      setServices(list);
      setStatus("ready");
      if (list.length === 0) {
        setError(t("grpc.noServices"));
      }
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [url, t]);

  const selectMethod = useCallback(
    (fullPath: string) => {
      setSelectedMethod(fullPath);
      const [serviceName, methodName] = fullPath.split("/");
      const svc = services.find((s) => s.name === serviceName);
      const method = svc?.methods.find((m) => m.name === methodName);
      if (method) {
        setPayload(JSON.stringify(method.inputExample, null, 2));
      }
    },
    [services],
  );

  const send = useCallback(async () => {
    if (!selectedMethod) return;
    setCalling(true);
    setError(null);
    setResult(null);
    try {
      const pairs = metadata.filter((m) => m.key.trim() && m.enabled !== false);
      const result = await grpcCall(
        url.trim(),
        selectedMethod,
        payload,
        pairs.map((m) => [m.key.trim(), m.value] as [string, string]),
      );
      setResult(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCalling(false);
    }
  }, [url, selectedMethod, payload, metadata]);

  const statusBadge =
    status === "loading" ? (
      <Badge variant="outline" className="shrink-0 gap-1.5 border-warning/20 bg-warning/10 text-warning">
        <Loader2 className="size-3 animate-spin" />
        {t("grpc.loading")}
      </Badge>
    ) : status === "ready" ? (
      <Badge variant="outline" className="shrink-0 gap-1.5 border-success/20 bg-success/10 text-success">
        <CheckCircle2 className="size-3" />
        {t("grpc.ready")}
      </Badge>
    ) : status === "error" ? (
      <Badge variant="outline" className="shrink-0 border-destructive/20 bg-destructive/10 text-destructive">
        <XCircle className="size-3" />
        {t("grpc.statusError")}
      </Badge>
    ) : (
      <Badge variant="outline" className="shrink-0 bg-muted text-muted-foreground">
        {t("grpc.statusIdle")}
      </Badge>
    );

  return (
    <div className="flex flex-1 min-w-0 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20">
            <Network className="size-3.5 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground tracking-tight leading-none">gRPC</h3>
            <p className="text-[10px] text-muted-foreground/40 leading-none mt-1">
              {t("grpc.subtitle")}
            </p>
          </div>
        </div>
      </div>

      {/* Connection bar */}
      <div className="p-3 pb-1">
        <div className="flex items-center gap-2 rounded-lg border border-input/50 px-3 py-1.5">
          {statusBadge}
          <div className="relative flex-1">
            <AutocompleteInput
              value={url}
              onChange={setUrl}
              placeholder="http://localhost:50051"
              className="font-mono text-sm h-9"
              suggestions={urlSuggestions}
              emptyMessage={t("request.noResults")}
            />
          </div>
          <Button
            size="sm"
            onClick={discover}
            disabled={status === "loading" || !url.trim()}
            className="shrink-0 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
          >
            {status === "loading" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            {t("grpc.discover")}
          </Button>
        </div>
      </div>

      {error && (
        <div className="px-3 pb-1">
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <span className="break-words">{error}</span>
          </div>
        </div>
      )}

      {/* Méthodes */}
      {services.length > 0 && (
        <div className="px-3 pb-1">
          <div className="rounded-lg border border-input/30 p-3 space-y-3">
            <div>
              <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                {t("grpc.method")}
              </Label>
              <select
                value={selectedMethod ?? ""}
                onChange={(e) => selectMethod(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-muted/20 px-2 py-1.5 font-mono text-xs"
              >
                <option value="">{t("grpc.selectMethod")}</option>
                {services.map((svc) => (
                  <optgroup key={svc.name} label={svc.name}>
                    {svc.methods.map((m) => (
                      <option key={m.name} value={`${svc.name}/${m.name}`}>
                        {svc.name}/{m.name}
                        {m.serverStreaming ? " (stream)" : ""}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            {/* Metadata */}
            <div>
              <button
                type="button"
                onClick={() => setShowMetadata((v) => !v)}
                className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground/60 hover:text-foreground"
              >
                {showMetadata ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                {t("grpc.metadata")}
              </button>
              {showMetadata && (
                <div className="mt-2">
                  <KeyValueEditor
                    pairs={metadata}
                    onChange={setMetadata}
                    keyPlaceholder={t("grpc.metadataName")}
                    valuePlaceholder={t("grpc.metadataValue")}
                    addLabel={t("grpc.metadataAdd")}
                    emptyLabel={t("grpc.metadataEmpty")}
                  />
                </div>
              )}
            </div>

            <div>
              <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                {t("grpc.payload")}
              </Label>
              <Textarea
                value={payload}
                onChange={(e) => setPayload(e.target.value)}
                rows={6}
                disabled={!selectedMethod}
                className="mt-1 font-mono text-xs"
              />
            </div>

            <Button
              size="sm"
              onClick={send}
              disabled={!selectedMethod || calling}
              className="gap-1.5"
            >
              {calling ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Send className="size-3.5" />
              )}
              {t("grpc.send")}
            </Button>
          </div>
        </div>
      )}

      {/* Résultat */}
      <div className="flex flex-1 min-h-0 flex-col px-3 pb-3 pt-1">
        {result && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge
                variant="outline"
                className={cn(
                  "gap-1.5",
                  result.status === "ok"
                    ? "border-success/20 bg-success/10 text-success"
                    : "border-destructive/20 bg-destructive/10 text-destructive",
                )}
              >
                {result.status === "ok" ? (
                  <CheckCircle2 className="size-3" />
                ) : (
                  <XCircle className="size-3" />
                )}
                {result.status === "ok"
                  ? t("grpc.ok")
                  : t("grpc.failed", { code: result.grpcStatusCode })}
                <Radio className="size-3" />
                {result.durationMs} ms
              </Badge>
              {result.grpcMessage && (
                <span className="text-[11px] text-muted-foreground">{result.grpcMessage}</span>
              )}
              {result.responses.length > 1 && (
                <span className="text-[11px] text-muted-foreground">
                  {t("grpc.messagesCount", { count: result.responses.length })}
                </span>
              )}
            </div>
            <ScrollArea className="max-h-[50vh] border border-border rounded-lg bg-muted/10">
              <div className="p-3 space-y-2">
                {result.responses.map((response, index) => (
                  <pre
                    key={index}
                    className="text-xs font-mono leading-relaxed whitespace-pre-wrap break-all text-foreground"
                  >
                    {typeof response === "string"
                      ? response
                      : JSON.stringify(response, null, 2)}
                  </pre>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}
      </div>
    </div>
  );
}

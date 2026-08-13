"use client";

import { useState } from "react";
import { Copy, Check, AlertCircle, CheckCircle2, AlertTriangle, Play } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

interface Props {
  data?: unknown;
  errors?: unknown;
  error?: string | null;
  status?: number;
  timeMs?: number;
  loading?: boolean;
}

const STATUS_TEXT: Record<number, string> = {
  0: "Network Error",
  200: "OK",
  201: "Created",
  204: "No Content",
  301: "Moved Permanently",
  302: "Found",
  304: "Not Modified",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  408: "Request Timeout",
  409: "Conflict",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

function statusLabel(code: number): string {
  return STATUS_TEXT[code] ?? "";
}

export function ResponseViewer({ data, errors, error, status, timeMs, loading }: Props) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const text: string = error
    ? error
    : (() => {
        try {
          return JSON.stringify({ data: data ?? null, errors: errors ?? null }, null, 2);
        } catch {
          return t("graphql.responseViewer.unableToSerialize");
        }
      })();

  const copy = async () => {
    if (typeof navigator !== "undefined") {
      await navigator.clipboard.writeText(text).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const graphqlErrors = Array.isArray(errors) ? errors : [];
  const isGraphQLError =
    status !== undefined && status >= 200 && status < 300 && graphqlErrors.length > 0;
  const isHttpError = status !== undefined && status >= 400;
  const isEmpty =
    (data === undefined || data === null) &&
    (errors === undefined || errors === null) &&
    (error === undefined || error === null) &&
    (status === undefined || status === null) &&
    !loading;

  if (isEmpty) {
    return (
      <div
        className="flex flex-col items-center justify-center h-full text-muted-foreground p-8"
        data-testid="graphql-response-empty"
      >
        <Play className="w-10 h-10 mb-3 opacity-30" />
        <p className="text-sm font-medium">{t("graphql.responseViewer.noResponse")}</p>
        <p className="text-xs mt-1 opacity-60">{t("graphql.responseViewer.runQueryToSee")}</p>
      </div>
    );
  }

  return (
    <div className="border-t bg-card" data-testid="graphql-response-viewer">
      <div className="flex items-center justify-between p-2 border-b">
        <div className="flex items-center gap-2 text-xs">
          {status !== undefined && (
            <Badge
              variant={isHttpError ? "destructive" : "outline"}
              className={cn(
                "gap-1",
                !isHttpError && !isGraphQLError && "border-success/40 bg-success/15 text-success",
                isGraphQLError && "border-warning/50 bg-warning/15 text-warning",
              )}
              data-testid="graphql-response-status"
            >
              {!isHttpError && !isGraphQLError && <CheckCircle2 className="w-3 h-3" />}
              {isGraphQLError && <AlertTriangle className="w-3 h-3" />}
              {isHttpError && <AlertCircle className="w-3 h-3" />}
              <span>
                {status}
                {statusLabel(status) && <> {statusLabel(status)}</>}
                {isGraphQLError && <> · {t("graphql.responseViewer.gqlError")}</>}
              </span>
            </Badge>
          )}
          {timeMs !== undefined && <span className="text-muted-foreground">{timeMs}ms</span>}
          {error && (
            <span className="text-destructive flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> {error}
            </span>
          )}
          {isGraphQLError && !error && (
            <span className="text-warning flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              {graphqlErrors.length === 1
                ? graphqlErrors[0]?.message
                : t("graphql.responseViewer.graphqlErrors", { count: graphqlErrors.length })}
            </span>
          )}
          {!error && graphqlErrors.length === 0 && data !== undefined && (
            <span className="text-success flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> {t("graphql.responseViewer.ok")}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={copy}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          data-testid="graphql-response-copy"
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copied ? t("graphql.responseViewer.copied") : t("graphql.responseViewer.copy")}
        </button>
      </div>
      <pre
        className="text-xs font-mono overflow-auto max-h-96 p-3 bg-muted/30 whitespace-pre-wrap"
        data-testid="graphql-response-data"
      >
        {loading ? t("graphql.responseViewer.loading") : text}
      </pre>
    </div>
  );
}

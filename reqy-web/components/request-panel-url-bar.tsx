"use client";

import { useState, useRef, useCallback } from "react";
import { Terminal, Code, Copy, Check, Loader2, Play, Braces, X, Route, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { normalizeUrl as canonicalNormalizeUrl } from "@/lib/request-executor";
import type { HttpMethod } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { AutocompleteInput, type AutocompleteGroup } from "@/components/ui/autocomplete-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { methodBg, methodDot } from "@/lib/http-method-colors";
import { toast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import type { BodyType, AuthType, QueryParam, Header } from "@/lib/request-executor";

export interface RequestPanelUrlBarProps {
  method: HttpMethod;
  url: string;
  queryParams: QueryParam[];
  headers: Header[];
  body: string;
  bodyType: BodyType;
  authType: AuthType;
  authToken: string;
  onMethodChange: (method: HttpMethod) => void;
  onUrlChange: (url: string) => void;
  onHeadersChange: (headers: Header[]) => void;
  onBodyChange: (body: string) => void;
  onBodyTypeChange: (bodyType: BodyType) => void;
  onAuthChange: (type: AuthType, token: string) => void;
  variableNames?: string[];
  onSend: () => Promise<void>;
  onCancel?: () => void;
  followRedirects?: boolean;
  onFollowRedirectsChange?: (follow: boolean) => void;
  isLoading?: boolean;
  urlAutocompleteGroups: AutocompleteGroup[];
  hasUrl: boolean;
}

export function RequestPanelUrlBar({
  method,
  url,
  queryParams,
  headers,
  body,
  authType,
  authToken,
  onMethodChange,
  onUrlChange,
  onHeadersChange,
  onBodyChange,
  onBodyTypeChange,
  onAuthChange,
  variableNames,
  onSend,
  onCancel,
  followRedirects,
  onFollowRedirectsChange,
  isLoading,
  urlAutocompleteGroups,
  hasUrl,
}: RequestPanelUrlBarProps) {
  const { t } = useTranslation();
  const [exportFormat, setExportFormat] = useState<"curl" | "fetch">("curl");
  const [exportCopied, setExportCopied] = useState(false);
  const [curlImportOpen, setCurlImportOpen] = useState(false);
  const [curlInput, setCurlInput] = useState("");
  const urlInputRef = useRef<HTMLInputElement>(null);

  const buildFullUrl = useCallback(() => {
    try {
      const finalUrl = new URL(canonicalNormalizeUrl(url));
      queryParams.forEach((param) => {
        if (param.enabled === false) return;
        if (!param.key.trim() || !param.value.trim()) return;
        finalUrl.searchParams.append(param.key.trim(), param.value.trim());
      });
      return finalUrl.toString();
    } catch {
      const queryString = queryParams
        .filter((param) => param.enabled !== false && param.key.trim() && param.value.trim())
        .map(
          (param) =>
            `${encodeURIComponent(param.key.trim())}=${encodeURIComponent(param.value.trim())}`,
        )
        .join("&");
      if (!queryString) return url;
      return url + (url.includes("?") ? "&" : "?") + queryString;
    }
  }, [url, queryParams]);

  const buildAuthHeaders = useCallback(() => {
    const authHeaders: Array<[string, string]> = [];
    if (authType !== "none" && authToken.trim()) {
      if (authType === "bearer" || authType === "oauth2") {
        authHeaders.push(["Authorization", `Bearer ${authToken.trim()}`]);
      } else if (authType === "basic") {
        authHeaders.push(["Authorization", `Basic ${authToken.trim()}`]);
      } else if (authType === "api-key") {
        authHeaders.push(["x-api-key", authToken.trim()]);
      }
    }
    return authHeaders;
  }, [authType, authToken]);

  const buildRequestHeaders = useCallback(() => {
    const requestHeaders: Array<[string, string]> = [...buildAuthHeaders()];
    headers.forEach((header) => {
      if (header.enabled !== false && header.key.trim() && header.value.trim()) {
        requestHeaders.push([header.key.trim(), header.value.trim()]);
      }
    });
    return requestHeaders;
  }, [headers, buildAuthHeaders]);

  const buildCurlCommand = useCallback(() => {
    const finalUrl = buildFullUrl();
    const headerLines = buildRequestHeaders().map(
      ([key, value]) => `-H "${key}: ${value.replace(/"/g, '\\"')}"`,
    );
    const bodyText = body && method !== "GET" ? `--data-raw '${body.replace(/'/g, "'\\''")}'` : "";
    const parts = ["curl", `-X ${method}`, ...headerLines];
    if (bodyText) parts.push(bodyText);
    parts.push(`"${finalUrl}"`);
    return parts.join(" \\\n      ");
  }, [method, buildFullUrl, buildRequestHeaders, body]);

  const buildFetchCommand = useCallback(() => {
    const finalUrl = buildFullUrl();
    const headersObject = Object.fromEntries(buildRequestHeaders());
    const bodyPart = body && method !== "GET" ? `  body: ${JSON.stringify(body)},\n` : "";
    return `fetch("${finalUrl}", {
  method: "${method}",
  headers: ${JSON.stringify(headersObject, null, 2)},
${bodyPart}})
  .then((res) => res.text())
  .then((text) => console.log(text));`;
  }, [method, buildFullUrl, buildRequestHeaders, body]);

  const getExportSnippet = useCallback(
    () => (exportFormat === "curl" ? buildCurlCommand() : buildFetchCommand()),
    [exportFormat, buildCurlCommand, buildFetchCommand],
  );

  const handleCopyExport = async () => {
    try {
      await navigator.clipboard.writeText(getExportSnippet());
      setExportCopied(true);
      setTimeout(() => setExportCopied(false), 2000);
    } catch {
      setExportCopied(false);
    }
  };

  return (
    <>
      {/* URL Bar */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-input/50 px-2.5 py-1 transition-all duration-200 sm:flex-nowrap">
        {/* Method select */}
        <Select value={method} onValueChange={(value) => onMethodChange(value as HttpMethod)}>
          <SelectTrigger
            aria-label="HTTP method"
            data-testid="method-selector"
            className={cn(
              "shrink-0 rounded-md border-0 px-2 py-0.5 text-[10px] font-bold font-mono cursor-pointer transition-all duration-200 outline-none ring-offset-0 focus:ring-0 focus:ring-offset-0 h-auto w-auto gap-0.5 [&>svg]:size-3",
              methodBg[method],
              "text-white",
            )}
          >
            <SelectValue placeholder={method} />
          </SelectTrigger>
          <SelectContent>
            {(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const).map((m) => (
              <SelectItem key={m} value={m}>
                <span className="flex items-center gap-2">
                  <span className={cn("size-1.5 rounded-full shrink-0", methodDot[m])} />
                  {m}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* URL Input with autocomplete */}
        <div className="relative order-5 min-w-0 basis-full flex-1 sm:order-none sm:basis-auto">
          <AutocompleteInput
            ref={urlInputRef}
            data-testid="url-input"
            value={url}
            onChange={onUrlChange}
            placeholder="https://api.example.com/endpoint"
            className="text-xs h-7 py-0 px-2"
            suggestions={urlAutocompleteGroups}
            emptyMessage={t("request.noResults")}
          />
        </div>

        {/* Paste cURL */}
        <div className="relative">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 sm:h-7 sm:w-7 p-0 text-muted-foreground/50 hover:text-foreground"
            onClick={() => {
              setCurlImportOpen(!curlImportOpen);
              setCurlInput("");
            }}
            title={t("request.curlPaste")}
          >
            <Terminal className="size-3.5" />
          </Button>
          {curlImportOpen && (
            <div className="absolute right-0 top-full mt-1 z-50 w-[calc(100vw-2rem)] max-w-[420px] rounded-lg border border-border bg-popover shadow-xl animate-in fade-in-0 zoom-in-95">
              <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border/40">
                <span className="text-xs font-semibold text-muted-foreground">
                  {t("request.curlPaste")}
                </span>
                <button
                  type="button"
                  onClick={() => setCurlImportOpen(false)}
                  className="flex size-8 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={t("common.close")}
                  title={t("common.close")}
                >
                  <X className="size-3.5" />
                </button>
              </div>
              <div className="p-3 space-y-2">
                <textarea
                  value={curlInput}
                  onChange={(e) => setCurlInput(e.target.value)}
                  placeholder={`curl -X POST https://api.example.com/data \\\n  -H "Content-Type: application/json" \\\n  -d '{"key": "value"}'`}
                  className="w-full h-24 rounded-md border border-input bg-muted/20 px-3 py-2 text-xs font-mono resize-none outline-none focus:border-primary/50 transition-colors"
                  spellCheck={false}
                />
                <div className="flex justify-end gap-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setCurlImportOpen(false)}
                  >
                    {t("common.cancel")}
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 text-xs gap-1"
                    disabled={!curlInput.trim()}
                    onClick={async () => {
                      try {
                        const { parseCurlCommand } = await import("@/lib/curl-parser");
                        const parsed = parseCurlCommand(curlInput);
                        if (!parsed) {
                          toast({
                            title: t("request.curlParseFailed"),
                            description: t("request.curlParseFailedHint"),
                            variant: "destructive",
                          });
                          return;
                        }
                        onMethodChange(parsed.method as HttpMethod);
                        onUrlChange(parsed.url);
                        const parsedHeaders = Object.entries(parsed.headers).map(
                          ([key, value]) => ({
                            key,
                            value,
                            enabled: true,
                          }),
                        );
                        onHeadersChange([...headers, ...parsedHeaders]);
                        if (parsed.body) {
                          onBodyChange(parsed.body);
                          onBodyTypeChange("raw");
                        }
                        if (parsed.auth)
                          onAuthChange(
                            "basic",
                            btoa(`${parsed.auth.username}:${parsed.auth.password}`),
                          );
                        setCurlImportOpen(false);
                        toast({
                          title: t("request.curlImported"),
                          description: `${parsed.method} ${parsed.url.slice(0, 60)}…`,
                        });
                      } catch (err) {
                        toast({
                          title: t("request.curlImportFailed"),
                          description: String(err),
                          variant: "destructive",
                        });
                      }
                    }}
                  >
                    <Terminal className="size-3" />
                    {t("request.curlImport")}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Variables dropdown */}
        {variableNames && variableNames.length > 0 && (
          <div className="relative">
            <select
              aria-label="Insert variable"
              className="h-8 sm:h-7 rounded-md border border-input/50 bg-muted/30 px-1.5 text-[10px] font-mono text-muted-foreground cursor-pointer outline-none hover:border-muted-foreground/30 appearance-none"
              value=""
              onChange={(e) => {
                const name = e.target.value;
                if (name && urlInputRef.current) {
                  const input = urlInputRef.current;
                  const start = input.selectionStart ?? url.length;
                  const end = input.selectionEnd ?? url.length;
                  const newUrl = url.slice(0, start) + `{{${name}}}` + url.slice(end);
                  onUrlChange(newUrl);
                  requestAnimationFrame(() => {
                    const pos = start + name.length + 4;
                    input.setSelectionRange(pos, pos);
                    input.focus();
                  });
                }
                e.target.value = "";
              }}
            >
              <option value="" disabled>
                {t("request.variables")}
              </option>
              {variableNames.map((n) => (
                <option key={n} value={n}>{`{{${n}}}`}</option>
              ))}
            </select>
          </div>
        )}

        {/* Follow redirects toggle (web proxy mode) */}
        {onFollowRedirectsChange && (
          <button
            type="button"
            data-testid="follow-redirects-toggle"
            onClick={() => onFollowRedirectsChange(!followRedirects)}
            title={t("request.followRedirectsHint")}
            aria-pressed={followRedirects}
            className={cn(
              "flex h-8 w-8 sm:h-7 sm:w-7 items-center justify-center rounded-md border transition-all duration-200",
              followRedirects
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-input/50 bg-muted/30 text-muted-foreground/50 hover:text-foreground hover:border-muted-foreground/30",
            )}
          >
            <Route className="size-3.5" />
            <span className="sr-only">{t("request.followRedirects")}</span>
          </button>
        )}

        <Button
          disabled={!hasUrl || isLoading}
          data-testid="send-button"
          onClick={async () => {
            if (!hasUrl) return;
            await onSend();
          }}
          className={cn(
            "h-7 shrink-0 gap-1.5 px-2.5 text-xs font-semibold transition-all duration-200",
            methodBg[method],
            "text-white hover:opacity-85",
          )}
          title={!hasUrl ? t("request.urlRequired") : t("request.send")}
        >
          {isLoading ? (
            <Loader2 className="size-3.5 animate-spin fill-current" />
          ) : (
            <Play className="size-3.5 fill-current" />
          )}
          <span>{isLoading ? t("request.sending") : t("request.send")}</span>
        </Button>

        {/* Cancel in-flight request */}
        {isLoading && onCancel && (
          <Button
            variant="outline"
            size="sm"
            data-testid="cancel-request-button"
            onClick={onCancel}
            className="h-7 shrink-0 gap-1.5 px-2.5 text-xs font-semibold border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive transition-all duration-200"
            title={t("request.cancel")}
          >
            <Square className="size-3 fill-current" />
            {t("request.cancel")}
          </Button>
        )}
      </div>

      {/* Variables in URL */}
      {hasUrl && url.includes("{{") && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 animate-slide-up">
          {Array.from(url.matchAll(/\{\{\s*(\w+)\s*\}\}/g)).map((match) => {
            const varName = match[1];
            return (
              <span
                key={varName}
                className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-mono font-medium text-primary border border-primary/20"
              >
                <Braces className="size-3" />
                {varName}
              </span>
            );
          })}
          {url.match(/\{\{[^}]+\}\}/g)?.some((m) => !m.match(/^\{\{\s*\w+\s*\}\}$/)) && (
            <span className="text-[11px] font-medium text-warning bg-warning/10 px-2 py-0.5 rounded-md">
              {t("request.invalidVariableSyntax")}
            </span>
          )}
        </div>
      )}
      {!hasUrl && (
        <p className="mt-1 px-2.5 text-xs text-muted-foreground/70">{t("request.enterUrlHint")}</p>
      )}

      {/* Export row */}
      <div className="mt-2 flex items-center justify-end gap-1.5 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Select
            value={exportFormat}
            onValueChange={(value) => setExportFormat(value as "curl" | "fetch")}
          >
            <SelectTrigger className="h-8 w-auto gap-2 border-input bg-muted/30 text-xs font-medium text-muted-foreground transition-all duration-200 hover:border-muted-foreground/30">
              <Code className="size-3.5" />
              <SelectValue placeholder={t("request.exportPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="curl">{t("request.exportCurl")}</SelectItem>
              <SelectItem value="fetch">{t("request.exportFetch")}</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            onClick={handleCopyExport}
            className={cn(
              "h-8 gap-1.5 text-xs font-medium transition-all duration-200",
              exportCopied ? "border-success/30 text-success bg-success/10" : "",
            )}
          >
            {exportCopied ? (
              <>
                <Check className="size-3.5" />
                {t("common.copied")}
              </>
            ) : (
              <>
                <Copy className="size-3.5" />
                {t("common.copy")}{" "}
                {exportFormat === "curl" ? t("request.exportCurl") : t("request.exportFetch")}
              </>
            )}
          </Button>
        </div>
      </div>
    </>
  );
}

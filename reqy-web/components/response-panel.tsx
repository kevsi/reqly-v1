"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { AlertCircle, Play, Loader2, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DiffDialog } from "@/components/diff-dialog";
import { analyze } from "@/src/ai/local-engine/analyzer";
import { buildRequestContext } from "@/src/ai/local-engine/context";
import type { RequestPayload } from "@/src/ai/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ResponseStatusBar } from "@/components/response-status-bar";
import { ResponseTimeline } from "@/components/response-timeline";

import { ResponseHeadersTab } from "@/components/response-headers-tab";
import { ResponseCookiesTab } from "@/components/response-cookies-tab";
import { CodeSnippet } from "@/components/response-code-snippet";
import { TestResultsSection } from "@/components/response-test-results";
import { ConsoleTab } from "@/components/response-console-tab";
import type { CorrectionSuggestion } from "@/src/ai/cloud-engine/actions/propose-correction";
import type { TauriCookie, TauriErrorPayload } from "@/lib/tauri";
import dynamic from "next/dynamic";

// Heavy dependencies â€” only loaded on demand (response received, AI opened).
const ResponseContentRenderer = dynamic(
  () =>
    import("@/components/response-content-renderer").then((m) => ({
      default: m.ResponseContentRenderer,
    })),
  { ssr: false, loading: () => null },
);
const AIModal = dynamic(
  () => import("@/src/ai/components/AIModal").then((m) => ({ default: m.AIModal })),
  { ssr: false, loading: () => null },
);
import {
  type ResponseFormat,
  isJson,
  isXml,
  isHtml,
  isImage,
  isPdf,
  isAudio,
  isVideo,
  isBinary,
  extractVideoUrls,
  extractImageUrls,
} from "@/components/response-utils";
import type { HistoryItem, TestResult } from "@/lib/types";
import type { ConsoleEntry } from "@/lib/test-runner/scripts";
import { getStatusBorderAccentClass } from "@/lib/http-status-colors";

interface ResponsePanelProps {
  responseBody?: string;
  responseData?: string | Blob;
  responseStatus?: number;
  responseTime?: number;
  responseTimings?: {
    dnsMs?: number;
    connectMs?: number;
    tlsMs?: number;
    ttfbMs?: number;
    transferMs?: number;
    totalMs?: number;
    transport?: "native" | "proxy";
  };
  responseSize?: string;
  responseHeaders?: Record<string, string>;
  transportError?: TauriErrorPayload | null;
  responseCookies?: TauriCookie[];
  isLoading?: boolean;
  onRun?: () => Promise<void>;
  onRetry?: () => Promise<void>;
  onRunAndSave?: () => Promise<void>;
  onRunAndDownload?: () => Promise<void>;
  onAnalyze?: () => Promise<void>;
  onGenerateTests?: () => Promise<void>;
  onPatchRequest?: (patch: Partial<RequestPayload>) => void;
  aiSummary?: string;
  aiError?: string;
  aiIsLoading?: boolean;
  method?: string;
  url?: string;
  requestHeaders?: Array<{ key: string; value: string }>;
  queryParams?: Array<{ key: string; value: string }>;
  body?: string;
  bodyType?: string;
  authType?: string;
  authToken?: string;
  testResults?: TestResult[];
  scriptLogs?: { pre: ConsoleEntry[]; post: ConsoleEntry[] };
  history?: HistoryItem[];
  proposeAskAI?: (prompt: string) => Promise<string>;
  onApplyCorrection?: (result: TestResult, suggestion: CorrectionSuggestion) => void;
}

export function ResponsePanel({
  responseBody,
  responseData,
  responseStatus,
  responseTime,
  responseTimings,
  responseSize,
  responseHeaders,
  transportError,
  responseCookies = [],
  testResults,
  scriptLogs,
  isLoading = false,
  onRun,
  onRetry,
  onRunAndSave,
  onRunAndDownload,
  onPatchRequest,
  aiIsLoading = false,
  method = "GET",
  url = "",
  requestHeaders = [],
  queryParams = [],
  body = "",
  bodyType = "none",
  authType = "none",
  authToken = "",
  history = [],
  proposeAskAI,
  onApplyCorrection,
}: ResponsePanelProps) {
  const { t } = useTranslation();
  function getAutoFormat(): ResponseFormat {
    if (responseData instanceof Blob && responseData.type === "application/pdf") {
      return "pdf";
    }
    if (isJson(responseBody, responseHeaders)) {
      try {
        const parsed = JSON.parse(responseBody as string);
        const videoUrls = extractVideoUrls(parsed);
        if (videoUrls.length > 0) return "preview";
        const imageUrls = extractImageUrls(parsed);
        if (imageUrls.length > 0) return "preview";
      } catch {
        // ignore
      }
      return "json";
    }
    if (isHtml(responseBody, responseHeaders)) return "html";
    if (isXml(responseBody, responseHeaders)) return "xml";
    if (isImage(responseData, responseHeaders)) return "image";
    if (isPdf(responseData, responseHeaders)) return "pdf";
    if (isAudio(responseData, responseHeaders)) return "audio";
    if (isVideo(responseData, responseHeaders)) return "video";
    if (isBinary(responseData, responseHeaders)) return "binary";
    return "pretty";
  }

  const [responseFormat, setResponseFormat] = useState<ResponseFormat>(() => {
    if (!responseBody && !responseData) return "pretty";
    return getAutoFormat();
  });
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setResponseFormat(responseBody || responseData ? getAutoFormat() : "pretty");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [responseBody, responseData, responseHeaders]);
  const [activeTab, setActiveTab] = useState("response");
  const [diffDialogOpen, setDiffDialogOpen] = useState(false);
  const [aiModalOpen, setAiModalOpen] = useState(false);

  const mediaUrl = useMemo(() => {
    if (responseData instanceof Blob) {
      return URL.createObjectURL(responseData);
    }
    return null;
  }, [responseData]);

  useEffect(() => {
    return () => {
      if (mediaUrl) URL.revokeObjectURL(mediaUrl);
    };
  }, [mediaUrl]);

  const responsePanelRef = useRef<HTMLDivElement>(null);

  const diagnostics = useMemo(() => {
    const headerRecord: Record<string, string> = {};
    for (const h of requestHeaders ?? []) {
      if (h.key) headerRecord[h.key] = h.value;
    }
    const ctx = buildRequestContext(
      {
        method: method as RequestPayload["method"],
        url: url ?? "",
        headers: headerRecord,
        body: body ?? null,
        authType: (authType ?? "none") as RequestPayload["authType"],
      },
      responseStatus !== undefined
        ? {
            status: responseStatus,
            statusText: "",
            headers: responseHeaders ?? {},
            body: responseBody,
            duration: responseTime ?? 0,
            size: 0,
          }
        : undefined,
    );
    return analyze(ctx);
  }, [
    method,
    url,
    requestHeaders,
    body,
    authType,
    responseStatus,
    responseHeaders,
    responseBody,
    responseTime,
  ]);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (responseBody) {
      const t0 = window.setTimeout(() => setFlash(true), 0);
      const timer = window.setTimeout(() => setFlash(false), 600);
      return () => {
        window.clearTimeout(t0);
        window.clearTimeout(timer);
      };
    }
  }, [responseBody, responseData, responseHeaders]);

  const hasResponse = Boolean(responseBody) || responseStatus !== undefined;

  // (La taille brute reste exposée par la barre de statut via responseSize.)

  // â”€â”€ Auto-format helper is declared earlier to be available for useState init

  const handleExport = useCallback(() => {
    if (!responseBody && !(responseData instanceof Blob)) return;
    try {
      const contentType =
        responseHeaders?.["content-type"] ??
        responseHeaders?.["Content-Type"] ??
        "application/octet-stream";
      const blob =
        responseData instanceof Blob
          ? responseData
          : new Blob([responseBody ?? ""], { type: contentType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = responseData instanceof Blob ? "response" : "response.txt";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  }, [responseBody, responseData, responseHeaders]);

  const handleRun = useCallback(async () => {
    if (!onRun) return;
    await onRun();
    setActiveTab("response");
  }, [onRun]);

  const handleOpenDiff = useCallback(() => setDiffDialogOpen(true), []);
  const handleOpenAi = useCallback(() => setAiModalOpen(true), []);

  return (
    <div
      ref={responsePanelRef}
      className={cn(
        "flex h-full flex-col bg-muted/20",
        getStatusBorderAccentClass(responseStatus),
        flash && "response-flash",
      )}
    >
      {transportError && (
        <div
          role="alert"
          className="flex items-start gap-2 border-b border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0 break-words">
            <p>{transportError.message}</p>
            {transportError.detail && (
              <p className="mt-1 text-xs text-destructive/80">{transportError.detail}</p>
            )}
          </div>
        </div>
      )}
      {Object.entries(responseHeaders ?? {}).some(
        ([key, value]) => key.toLowerCase() === "x-proxy-truncated" && value === "1",
      ) && (
        <div className="flex items-center gap-2 border-b border-warning/20 bg-warning/5 px-4 py-2 text-xs text-warning">
          <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
          {t("response.truncated")}
        </div>
      )}
      <ResponseStatusBar
        responseStatus={responseStatus}
        responseTime={responseTime}
        responseSize={responseSize}
        isLoading={isLoading}
        hasResponse={hasResponse}
        aiIsLoading={aiIsLoading}
        onRun={onRetry ?? onRun}
        onRunAndSave={onRunAndSave}
        onRunAndDownload={onRunAndDownload}
        onExport={handleExport}
        onDiff={handleOpenDiff}
      />

      <ResponseTimeline
        timings={{
          dnsMs: responseTimings?.dnsMs,
          connectMs: responseTimings?.connectMs,
          tlsMs: responseTimings?.tlsMs,
          ttfbMs: responseTimings?.ttfbMs,
          transferMs: responseTimings?.transferMs,
          totalMs: responseTime ?? 0,
          transport: responseTimings?.transport,
        }}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-border px-4">
          <TabsList className="h-auto gap-0 bg-transparent p-0 -mb-px flex w-full overflow-x-auto overflow-y-hidden [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] justify-start [&>button]:shrink-0 [&>button]:scroll-snap-align-start">
            <TabsTrigger
              value="response"
              className="rounded-none border-b-2 border-transparent px-4 py-2.5 text-xs font-semibold uppercase tracking-wider transition-all duration-200 data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=inactive]:text-muted-foreground/80 data-[state=inactive]:hover:text-foreground data-[state=inactive]:hover:border-muted-foreground/20"
            >
              {t("response.tabResponse")}
              {hasResponse && (
                <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-xs font-mono text-primary">
                  {responseStatus ?? "-"}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="headers"
              className="rounded-none border-b-2 border-transparent px-4 py-2.5 text-xs font-semibold uppercase tracking-wider transition-all duration-200 data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=inactive]:text-muted-foreground/80 data-[state=inactive]:hover:text-foreground data-[state=inactive]:hover:border-muted-foreground/20"
            >
              {t("response.tabHeaders")}
              
            </TabsTrigger>
            <TabsTrigger
              value="cookies"
              className="rounded-none border-b-2 border-transparent px-4 py-2.5 text-xs font-semibold uppercase tracking-wider transition-all duration-200 data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=inactive]:text-muted-foreground/80 data-[state=inactive]:hover:text-foreground data-[state=inactive]:hover:border-muted-foreground/20"
            >
              {t("response.tabCookies")}
              
            </TabsTrigger>
            <TabsTrigger
              value="code"
              className="rounded-none border-b-2 border-transparent px-4 py-2.5 text-xs font-semibold uppercase tracking-wider transition-all duration-200 data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=inactive]:text-muted-foreground/80 data-[state=inactive]:hover:text-foreground data-[state=inactive]:hover:border-muted-foreground/20"
            >
              {t("response.tabCode")}
            </TabsTrigger>
            <TabsTrigger
              value="tests"
              className="rounded-none border-b-2 border-transparent px-4 py-2.5 text-xs font-semibold uppercase tracking-wider transition-all duration-200 data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=inactive]:text-muted-foreground/80 data-[state=inactive]:hover:text-foreground data-[state=inactive]:hover:border-muted-foreground/20"
            >
              {t("response.tabTests")}
              {testResults && testResults.length > 0 && (
                <span
                  className={cn(
                    "ml-1.5 rounded-full px-1.5 py-0.5 text-xs font-mono tabular-nums",
                    testResults.every((r) => r.passed)
                      ? "bg-success/10 text-success"
                      : "bg-destructive/10 text-destructive",
                  )}
                >
                  {testResults.filter((r) => r.passed).length}/{testResults.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="timeline"
              className="rounded-none border-b-2 border-transparent px-4 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=inactive]:text-muted-foreground/80 data-[state=inactive]:hover:text-foreground data-[state=inactive]:hover:border-muted-foreground/20"
            >
              {t("response.tabTimeline", "Timeline")}
            </TabsTrigger>
            <TabsTrigger
              value="console"
              className="rounded-none border-b-2 border-transparent px-4 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=inactive]:text-muted-foreground/80 data-[state=inactive]:hover:text-foreground data-[state=inactive]:hover:border-muted-foreground/20"
            >
              {t("response.tabConsole", "Console")}
              {scriptLogs && (scriptLogs.pre.length + scriptLogs.post.length) > 0 && (
                <span className="ml-1.5 rounded-full bg-muted-foreground/10 px-1.5 py-0.5 text-xs font-mono tabular-nums">
                  {scriptLogs.pre.length + scriptLogs.post.length}
                </span>
              )}
            </TabsTrigger>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleOpenAi}
              className="ml-auto inline-flex items-center gap-1.5 h-auto px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-primary hover:bg-primary/10"
              data-testid="btn-ai-open"
            >
              <Sparkles className="size-3.5" />
              {t("response.ai")}
              {diagnostics.length > 0 && (
                <span className="ml-1 rounded-full bg-destructive/20 text-destructive px-1.5 py-0.5 text-xs font-mono tabular-nums">
                  {diagnostics.length}
                </span>
              )}
            </Button>
          </TabsList>
        </div>

        <TabsContent
          value="response"
          data-testid="response-body"
          className="m-0 min-h-0 flex-1 animate-fade-in relative overflow-hidden bg-muted/5"
        >
          {/* La taille est déjà affichée dans la barre de statut (haut) :
              pas de doublon au-dessus du corps de réponse. */}

          {/* Content layer above giant code */}
          <div className="relative z-10 h-full">
            {isLoading ? (
              <div className="flex flex-col h-full">
                <div className="shrink-0 px-4 py-3 border-b border-border/50">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 rounded-lg border border-warning/20 bg-warning/5 px-3 py-1.5">
                      <Loader2 className="size-3.5 animate-spin text-warning" />
                      <span className="text-xs font-medium text-warning">
                        {t("response.loading")}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col gap-3 p-6">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ) : hasResponse ? (
              <ResponseContentRenderer
                responseBody={responseBody}
                responseData={responseData}
                responseHeaders={responseHeaders}
                responseFormat={responseFormat}
                onFormatChange={setResponseFormat}
                mediaUrl={mediaUrl}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-center px-4">
                <div className="rounded-2xl bg-muted/40 border border-border p-5 mb-4">
                  <Play className="size-10 text-muted-foreground/30" />
                </div>
                <p className="text-sm font-semibold text-foreground/80">
                  {t("response.emptyTitle")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground/60 max-w-[200px]">
                  {t("response.emptyDescription")}
                </p>
                <Button
                  onClick={handleRun}
                  size="sm"
                  className="mt-4 h-8 gap-1.5 text-xs font-semibold"
                >
                  <Play className="size-3.5 fill-current" />
                  {t("response.sendRequest")}
                </Button>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="headers" className="m-0 min-h-0 flex-1 animate-fade-in">
          <ResponseHeadersTab responseHeaders={responseHeaders} />
        </TabsContent>

        <TabsContent value="cookies" className="m-0 min-h-0 flex-1 animate-fade-in">
          <ResponseCookiesTab responseCookies={responseCookies} />
        </TabsContent>

        <TabsContent value="code" className="m-0 flex min-h-0 flex-1 flex-col p-4 animate-fade-in">
          <CodeSnippet
            method={method}
            url={url}
            queryParams={queryParams}
            requestHeaders={requestHeaders}
            body={body}
            bodyType={bodyType}
            authType={authType}
            authToken={authToken}
          />
        </TabsContent>

        <TabsContent value="tests" className="m-0 min-h-0 flex-1 animate-fade-in overflow-auto">
          <TestResultsSection
            testResults={testResults ?? []}
            endpoint={`${method} ${url}`}
            responseStatus={responseStatus}
            responseBody={responseBody}
            askAI={proposeAskAI}
            onApplyCorrection={onApplyCorrection}
          />
        </TabsContent>
        <TabsContent value="timeline" className="m-0 min-h-0 flex-1 animate-fade-in overflow-auto">
          <div className="p-4">
            <ResponseTimeline
              timings={{
                dnsMs: responseTimings?.dnsMs,
                connectMs: responseTimings?.connectMs,
                tlsMs: responseTimings?.tlsMs,
                ttfbMs: responseTimings?.ttfbMs,
                transferMs: responseTimings?.transferMs,
                totalMs: responseTime ?? 0,
                transport: responseTimings?.transport,
              }}
            />
            {!responseTime && (
              <p className="text-xs text-muted-foreground italic mt-4">
                {t("response.timelineEmpty", "Envoyez une requête pour voir le breakdown réseau")}
              </p>
            )}
          </div>
        </TabsContent>
        <TabsContent value="console" className="m-0 min-h-0 flex-1 animate-fade-in">
          <ConsoleTab
            entries={[
              ...(scriptLogs?.pre ?? []),
              ...(scriptLogs?.post ?? []),
            ].sort((a, b) => a.timestamp - b.timestamp)}
          />
        </TabsContent>
      </Tabs>

      <DiffDialog
        open={diffDialogOpen}
        onOpenChange={setDiffDialogOpen}
        history={history}
        currentResponse={responseBody}
        currentResponseStatus={responseStatus}
      />

      <AIModal
        open={aiModalOpen}
        onOpenChange={setAiModalOpen}
        method={method}
        url={url}
        requestHeaders={requestHeaders}
        requestBody={body}
        responseStatus={responseStatus}
        responseHeaders={responseHeaders}
        responseBody={responseBody}
        authToken={authToken}
        onPatchRequest={onPatchRequest}
      />
    </div>
  );
}

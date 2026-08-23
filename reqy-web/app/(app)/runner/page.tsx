"use client";

import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Play,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
  ListChecks,
  Terminal,
  CircleSlash,
  Upload,
  Trash2,
  Download,
  RotateCcw,
  GripVertical,
  Folder,
  FolderOpen,
  Zap,
  Gauge,
  Settings,
  ChevronRight,
  ChevronDown,
  Plus,
  ArrowUpDown,
  BarChart3,
  Activity,
  Sparkles,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useRequestStore, type Collection, type RequestItem } from "@/hooks/use-request-store";
import {
  buildIterationContexts,
  moveItemById,
  runCollection as runCollectionEngine,
  type RunnerOptions,
} from "@/lib/test-runner/runner";
import { createRunnerExecutor, runRequestsConcurrent } from "@/lib/test-runner/executor";
import { loadJsonDataset, loadCsvDataset } from "@/lib/test-runner/data-driven";
import {
  type CollectionRunReport,
  type RequestTestResult,
  type AssertionResult,
  type Assertion,
  type AssertionStatus,
  type RunnerContext,
  type VariableExtractionRule,
  type PerformanceReport,
} from "@/lib/test-runner/types";
import { EnvironmentSelector } from "@/components/environment-selector";
import { computeDynamicVars } from "@/lib/variable-mapping";
import { methodText } from "@/lib/http-method-colors";
import { resolveSelectedCollectionId } from "@/lib/runner-state";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { TauriErrorPayload } from "@/lib/tauri";

type RequestTestResultWithTransportError = RequestTestResult & {
  transportError?: TauriErrorPayload | null;
};

function formatDuration(ms?: number) {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

const STATUS_BADGE = (status: number) => {
  if (status >= 500) return "bg-destructive/10 text-destructive";
  if (status >= 400) return "bg-warning/10 text-warning";
  if (status >= 300) return "bg-sky-500/10 text-sky-500";
  return "bg-success/10 text-success";
};

const STATUS_META: Record<
  AssertionStatus,
  { labelKey: string; icon: LucideIcon; color: string; dot: string }
> = {
  pass: {
    labelKey: "runner.status.pass",
    icon: CheckCircle2,
    color: "text-success",
    dot: "bg-success",
  },
  fail: {
    labelKey: "runner.status.fail",
    icon: XCircle,
    color: "text-destructive",
    dot: "bg-destructive",
  },
  skipped: {
    labelKey: "runner.status.skipped",
    icon: CircleSlash,
    color: "text-muted-foreground",
    dot: "bg-muted-foreground",
  },
  errored: {
    labelKey: "runner.status.errored",
    icon: AlertCircle,
    color: "text-warning",
    dot: "bg-warning",
  },
};

function describeAssertion(t: TFunction<"translation">, a: Assertion): string {
  switch (a.type) {
    case "status": {
      if (typeof a.expected === "number")
        return t("runner.describe.statusEquals", { value: a.expected });
      if ("in" in a.expected)
        return t("runner.describe.statusIn", { values: a.expected.in.join(", ") });
      return t("runner.describe.statusNot", { value: a.expected.not });
    }
    case "responseTime":
      return t("runner.describe.responseTime", { operator: a.operator, value: a.valueMs });
    case "jsonPath": {
      const op =
        a.operator === "exists"
          ? t("runner.describe.exists")
          : a.operator === "notExists"
            ? t("runner.describe.notExists")
            : a.operator === "equals"
              ? t("runner.describe.equals", { value: JSON.stringify(a.value) })
              : a.operator === "contains"
                ? t("runner.describe.contains", { value: JSON.stringify(a.value) })
                : a.operator;
      return t("runner.describe.jsonPath", { path: a.path, op });
    }
    case "header": {
      const op =
        a.operator === "exists"
          ? "existe"
          : a.operator === "equals"
            ? `=${a.value}`
            : `contient ${a.value}`;
      return `Header "${a.name}" ${op}`;
    }
    case "schema":
      return t("runner.describe.schema");
    default:
      return t("runner.describe.assertion");
  }
}

function formatActual(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "string") return v;
  try {
    const str = JSON.stringify(v);
    return str.length > 80 ? str.slice(0, 80) + "…" : str;
  } catch {
    return String(v);
  }
}

function RequestResultItem({
  result,
  accordionValue,
}: {
  result: RequestTestResultWithTransportError;
  accordionValue: string;
}) {
  const { t } = useTranslation();
  const meta = STATUS_META[result.status];
  const StatusIcon = meta.icon;
  const hasScript = !!(result.scriptOutput?.pre || result.scriptOutput?.post);
  const hasAssertions = result.assertionResults.length > 0;
  const transportError = result.transportError;

  return (
    <AccordionItem value={accordionValue} className="px-3 border rounded-lg bg-card mb-2">
      <AccordionTrigger className="items-center gap-3 py-3 hover:no-underline">
        <span className={cn("size-2 rounded-full shrink-0", meta.dot)} />
        <span className="flex-1 min-w-0 truncate font-medium text-sm text-foreground text-left">
          {result.requestName}
        </span>
        {result.statusCode != null && (
          <span
            className={cn(
              "font-mono text-xs font-semibold rounded px-1.5 py-0.5 shrink-0",
              STATUS_BADGE(result.statusCode),
            )}
          >
            {result.statusCode}
          </span>
        )}
        {result.responseTimeMs != null && (
          <span className="font-mono text-xs text-muted-foreground shrink-0 flex items-center gap-1">
            <Clock className="size-3" />
            {formatDuration(result.responseTimeMs)}
          </span>
        )}
        <StatusIcon className={cn("size-4 shrink-0", meta.color)} />
      </AccordionTrigger>
      <AccordionContent className="pb-3 pt-1 border-t">
        {(transportError || result.error) && (
          <div className="mb-3 mt-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <p className="font-medium">{transportError?.message ?? result.error}</p>
            {transportError?.detail && (
              <details className="mt-2 rounded border border-destructive/20 bg-background/40">
                <summary className="cursor-pointer px-2 py-1.5 font-semibold">
                  Détails techniques
                </summary>
                <pre className="border-t border-destructive/20 px-2 py-2 font-mono whitespace-pre-wrap break-words text-muted-foreground">
                  {transportError.detail}
                </pre>
              </details>
            )}
          </div>
        )}
        {hasAssertions && (
          <div className="space-y-1.5 mt-2">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t("runner.assertions")} ({result.assertionResults.filter((a) => a.passed).length}/
              {result.assertionResults.length})
            </p>
            <div className="divide-y divide-border rounded-lg border border-border bg-muted/20">
              {result.assertionResults.map((ar: AssertionResult, i: number) => (
                <div key={i} className="flex items-start gap-2.5 px-3 py-2 text-xs">
                  {ar.passed ? (
                    <CheckCircle2 className="size-3.5 text-success shrink-0 translate-y-0.5" />
                  ) : (
                    <XCircle className="size-3.5 text-destructive shrink-0 translate-y-0.5" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground">
                      {describeAssertion(t, ar.assertion)}
                    </p>
                    {ar.error ? (
                      <p className="font-mono text-[11px] text-destructive/90 truncate mt-0.5">
                        {ar.error}
                      </p>
                    ) : (
                      <p className="font-mono text-[11px] text-muted-foreground truncate mt-0.5">
                        {t("runner.actual")} {formatActual(ar.actualValue)}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {!hasAssertions && !hasScript && !result.error && (
          <p className="text-xs text-muted-foreground mt-2">{t("runner.noAssertionsOrScripts")}</p>
        )}
        {hasScript && (
          <div className="mt-3 space-y-2">
            <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              <Terminal className="size-3.5" />
              {t("runner.scriptOutput")}
            </p>
            {result.scriptOutput?.pre && (
              <pre className="overflow-auto rounded-lg border border-border bg-[var(--code-bg)] p-2.5 font-mono text-[11px] text-[var(--code-text)]">
                {result.scriptOutput.pre}
              </pre>
            )}
            {result.scriptOutput?.post && (
              <pre className="overflow-auto rounded-lg border border-border bg-[var(--code-bg)] p-2.5 font-mono text-[11px] text-[var(--code-text)]">
                {result.scriptOutput.post}
              </pre>
            )}
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}

export default function RunnerPage() {
  const { t } = useTranslation();
  const { collections, environmentVariables, variableMappings, history, activeWorkspaceId } =
    useRequestStore();

  const [selectedId, setSelectedId] = useState<string>("");
  const effectiveSelectedId = useMemo(
    () => resolveSelectedCollectionId(collections, selectedId),
    [collections, selectedId],
  );
  const selected: Collection | null =
    collections.find((c) => c.id === effectiveSelectedId) ?? collections[0] ?? null;

  useEffect(() => {
    if (selectedId !== effectiveSelectedId) {
      // Sync the selection state when the resolved collection changes
      // (e.g. the previously selected collection was deleted).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedId(effectiveSelectedId);
    }
  }, [effectiveSelectedId, selectedId]);

  // Feature 1: Ordered requests sequence (supports HTML5 Drag & Drop)
  const [orderedRequests, setOrderedRequests] = useState<RequestItem[]>([]);
  const [draggedRequestId, setDraggedRequestId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  // Sync ordered requests when collection changes
  useEffect(() => {
    if (selected?.requests) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOrderedRequests([...selected.requests]);
    } else {
      setOrderedRequests([]);
    }
  }, [selectedId, selected]);

  // Selected request IDs (Checklist)
  const [selectedRequestIds, setSelectedRequestIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (selected?.requests) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedRequestIds(new Set(selected.requests.map((r) => r.id)));
    } else {
      setSelectedRequestIds(new Set());
    }
  }, [selectedId, selected]);

  // Feature 2: Folder expand/collapse state
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set());

  const toggleFolderExpand = (folderId: string) => {
    setExpandedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  const toggleFolderRequestsSelection = (folderId: string, requestsInFolder: RequestItem[]) => {
    const allChecked = requestsInFolder.every((r) => selectedRequestIds.has(r.id));
    setSelectedRequestIds((prev) => {
      const next = new Set(prev);
      for (const r of requestsInFolder) {
        if (allChecked) next.delete(r.id);
        else next.add(r.id);
      }
      return next;
    });
  };

  // Feature 3: Performance mode & Virtual Users
  const [runType, setRunType] = useState<"functional" | "performance">("functional");
  const [runMethod, setRunMethod] = useState<"local" | "proxy">("local");
  const [virtualUsers, setVirtualUsers] = useState<number>(10);
  const [iterationsCount, setIterationsCount] = useState<number>(1);
  const [stopOnFailure, setStopOnFailure] = useState(false);
  const [delayMs, setDelayMs] = useState<number>(0);

  // Feature 4: Visual Variable Extraction rules (No-code Chaining)
  const [extractions, setExtractions] = useState<VariableExtractionRule[]>([
    { id: "ext-1", source: "jsonPath", path: "$.token", variableName: "authToken" },
  ]);

  const addExtractionRule = () => {
    setExtractions((prev) => [
      ...prev,
      { id: `ext-${Date.now()}`, source: "jsonPath", path: "", variableName: "" },
    ]);
  };

  const removeExtractionRule = (id: string) => {
    setExtractions((prev) => prev.filter((r) => r.id !== id));
  };

  const updateExtractionRule = (id: string, patch: Partial<VariableExtractionRule>) => {
    setExtractions((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  // Dataset state
  const [, setDatasetText] = useState("");
  const [datasetRows, setDatasetRows] = useState<Record<string, string>[]>([]);
  const [, setDatasetError] = useState<string | null>(null);
  const [, setDatasetFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Modal & Run state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentExecutingName, setCurrentExecutingName] = useState<string | null>(null);
  const [report, setReport] = useState<CollectionRunReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filterTab, setFilterTab] = useState<string>("all");

  const runAbortControllerRef = useRef<AbortController | null>(null);

  const totalCollectionRequests = orderedRequests.length;
  const selectedCount = selectedRequestIds.size;
  const canRun = !!selected && selectedCount > 0 && !isRunning;

  // HTML5 Drag & Drop handlers for sequence reordering
  const handleDragStart = (requestId: string, event: React.DragEvent) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", requestId);
    event.dataTransfer.setData("application/x-reqly-request-id", requestId);
    event.dataTransfer.dropEffect = "move";
    setDraggedRequestId(requestId);
    setDropTargetId(null);
  };

  const handleDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";

    const draggedId =
      e.dataTransfer.getData("application/x-reqly-request-id") ||
      e.dataTransfer.getData("text/plain");
    if (!draggedId || draggedId === targetId) {
      setDropTargetId(null);
      return;
    }

    setDropTargetId(targetId);
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const draggedId =
      e.dataTransfer.getData("application/x-reqly-request-id") ||
      e.dataTransfer.getData("text/plain");
    if (!draggedId || !targetId || draggedId === targetId) {
      setDraggedRequestId(null);
      setDropTargetId(null);
      return;
    }

    setOrderedRequests((prev) => moveItemById(prev, draggedId, targetId));
    setDraggedRequestId(null);
    setDropTargetId(null);
  };

  const handleDragEnd = () => {
    setDraggedRequestId(null);
    setDropTargetId(null);
  };

  const toggleRequestSelection = (id: string) => {
    setSelectedRequestIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selected?.requests) {
      setSelectedRequestIds(new Set(selected.requests.map((r) => r.id)));
    }
  };

  const handleDeselectAll = () => {
    setSelectedRequestIds(new Set());
  };

  const handleResetSequence = () => {
    if (selected?.requests) {
      setOrderedRequests([...selected.requests]);
      setSelectedRequestIds(new Set(selected.requests.map((r) => r.id)));
    }
  };

  const mergedEnvironment = useMemo(() => {
    const base: Record<string, string> = { ...(environmentVariables ?? {}) };
    if (variableMappings && history) {
      const dynamic = computeDynamicVars(variableMappings, history);
      for (const d of dynamic) {
        if (d.enabled) base[d.key] = d.value;
      }
    }
    return base;
  }, [environmentVariables, variableMappings, history]);

  const baseContext = useMemo<RunnerContext>(
    () => ({
      environment: mergedEnvironment,
      iterationData: {},
      iterationIndex: 0,
      log: () => {},
    }),
    [mergedEnvironment],
  );

  const iterations = useMemo<RunnerContext[] | undefined>(() => {
    return buildIterationContexts(baseContext, datasetRows, iterationsCount);
  }, [baseContext, datasetRows, iterationsCount]);

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setDatasetError(null);
      const reader = new FileReader();
      reader.onload = (evt) => {
        const text = evt.target?.result as string;
        setDatasetText(text);
        setDatasetFileName(file.name);
        try {
          setDatasetRows(loadJsonDataset(text));
          return;
        } catch {
          /* fall through */
        }
        try {
          const rows = loadCsvDataset(text);
          if (rows.length === 0) {
            setDatasetError(t("runner.errorNoRows"));
            return;
          }
          setDatasetRows(rows);
        } catch (e) {
          setDatasetError(e instanceof Error ? e.message : t("runner.errorParse"));
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    },
    [t],
  );

  const handleClearDataset = useCallback(() => {
    setDatasetText("");
    setDatasetRows([]);
    setDatasetError(null);
    setDatasetFileName(null);
  }, []);

  const handleCancel = () => {
    runAbortControllerRef.current?.abort();
  };

  const handleRun = async () => {
    if (!selected) return;

    const filteredRequests = orderedRequests.filter((r) => selectedRequestIds.has(r.id));
    if (filteredRequests.length === 0) return;

    const collectionToRun: Collection = {
      ...selected,
      requests: filteredRequests,
    };

    const controller = new AbortController();
    runAbortControllerRef.current = controller;
    setIsRunning(true);
    setIsModalOpen(true);
    setProgress(0);
    setCurrentExecutingName(filteredRequests[0]?.name ?? null);
    setReport(null);
    setError(null);
    setFilterTab("all");

    try {
      if (runType === "performance") {
        // Feature 3: Performance Stress / Concurrent Load Engine
        const startTime = Date.now();
        const requestInputs = filteredRequests.map((r) => ({
          method: r.method,
          url: r.url,
          headers: r.headers ?? {},
          body: r.body,
        }));

        // Run requests concurrently with bounded worker pool matching Virtual Users
        const concurrentResults = await runRequestsConcurrent(requestInputs, {
          workspaceId: activeWorkspaceId,
          signal: controller.signal,
          concurrency: virtualUsers,
          serverSide: runMethod === "local",
        });

        const endTime = Date.now();
        const totalTimeMs = Math.max(1, endTime - startTime);
        const latencies = concurrentResults
          .filter((r) => r.ok)
          .map((r) => (r.ok ? r.response.responseTimeMs : 0));

        const avgLatency =
          latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
        const minLatency = latencies.length > 0 ? Math.min(...latencies) : 0;
        const maxLatency = latencies.length > 0 ? Math.max(...latencies) : 0;
        const errorCount = concurrentResults.filter(
          (r) => !r.ok || (r.ok && r.response.statusCode >= 400),
        ).length;

        const perfReport: PerformanceReport = {
          throughputRps: Number(((concurrentResults.length / totalTimeMs) * 1000).toFixed(1)),
          avgLatencyMs: Math.round(avgLatency),
          minLatencyMs: Math.round(minLatency),
          maxLatencyMs: Math.round(maxLatency),
          errorRatePercent: Number(((errorCount / concurrentResults.length) * 100).toFixed(1)),
          virtualUsers,
        };

        const mappedResults: RequestTestResult[] = concurrentResults.map((res, i) => ({
          requestId: filteredRequests[i].id,
          requestName: filteredRequests[i].name,
          status: res.ok && res.response.statusCode < 400 ? "pass" : "fail",
          statusCode: res.ok ? res.response.statusCode : 0,
          responseTimeMs: res.ok ? res.response.responseTimeMs : 0,
          assertionResults: [],
          error: res.ok ? undefined : res.error,
        }));

        const finalReport: CollectionRunReport = {
          collectionId: selected.id,
          collectionName: selected.name,
          startedAt: startTime,
          completedAt: endTime,
          totalDurationMs: totalTimeMs,
          results: mappedResults,
          summary: {
            total: mappedResults.length,
            passed: mappedResults.filter((r) => r.status === "pass").length,
            failed: mappedResults.filter((r) => r.status === "fail").length,
            skipped: 0,
            errored: 0,
          },
          performanceReport: perfReport,
        };

        setReport(finalReport);
        setProgress(100);
      } else {
        // Functional Run Mode with Visual Extractions & onRequestDone
        const opts: RunnerOptions = {
          executor: createRunnerExecutor({
            workspaceId: activeWorkspaceId,
            signal: controller.signal,
            serverSide: runMethod === "local",
          }),
          signal: controller.signal,
          stopOnFailure,
          delayMs,
          extractions,
          onRequestDone: (completed, total, res) => {
            if (!controller.signal.aborted) {
              setProgress(Math.round((completed / total) * 100));
              setCurrentExecutingName(res.requestName);
            }
          },
        };
        if (iterations) opts.iterations = iterations;

        const result = await runCollectionEngine(collectionToRun, baseContext, opts);
        setReport(result);
        setProgress(controller.signal.aborted ? 0 : 100);
      }
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err));
    } finally {
      runAbortControllerRef.current = null;
      setIsRunning(false);
      setCurrentExecutingName(null);
    }
  };

  const reRunFailed = async () => {
    if (!selected || !report) return;
    const failedIds = new Set(
      report.results
        .filter((r) => r.status === "fail" || r.status === "errored")
        .map((r) => r.requestId),
    );
    const failedRequests = orderedRequests.filter((r) => failedIds.has(r.id));
    if (failedRequests.length === 0) return;

    const controller = new AbortController();
    runAbortControllerRef.current = controller;
    setIsRunning(true);
    setProgress(0);
    setFilterTab("all");

    try {
      const result = await runCollectionEngine(
        { ...selected, requests: failedRequests } as Collection,
        baseContext,
        {
          executor: createRunnerExecutor({
            workspaceId: activeWorkspaceId,
            signal: controller.signal,
            serverSide: runMethod === "local",
          }),
          iterations,
          signal: controller.signal,
          stopOnFailure,
          delayMs,
          extractions,
          onRequestDone: (completed, total, res) => {
            if (!controller.signal.aborted) {
              setProgress(Math.round((completed / total) * 100));
              setCurrentExecutingName(res.requestName);
            }
          },
        },
      );
      const merged = {
        ...report,
        results: report.results.map((r) => {
          const replacement = result.results.find((rr) => rr.requestId === r.requestId);
          return replacement ?? r;
        }),
        summary: result.summary,
        totalDurationMs: result.totalDurationMs,
        completedAt: result.completedAt,
      };
      setReport(merged);
      setProgress(controller.signal.aborted ? 0 : 100);
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err));
    } finally {
      runAbortControllerRef.current = null;
      setIsRunning(false);
      setCurrentExecutingName(null);
    }
  };

  const exportReport = useCallback(
    (format: "json" | "junit") => {
      if (!report) return;
      if (format === "json") {
        const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${report.collectionName}-report.json`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        import("@/lib/test-runner/junit-export").then(({ toJUnitXml }) => {
          const xml = toJUnitXml(report);
          const blob = new Blob([xml], { type: "application/xml" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${report.collectionName}-report.xml`;
          a.click();
          URL.revokeObjectURL(url);
        });
      }
    },
    [report],
  );

  const summary = report?.summary;
  const hasFailures = (summary?.failed ?? 0) + (summary?.errored ?? 0) > 0;

  const results = useMemo(() => report?.results ?? [], [report]);
  const filteredResults = useMemo(() => {
    if (filterTab === "all") return results;
    return results.filter((r) => r.status === filterTab);
  }, [results, filterTab]);

  // Group requests by folder for feature 2
  const collectionFolders = selected?.folders ?? [];

  return (
    <main className="flex-1 overflow-auto bg-muted/10 p-4 hide-scrollbar sm:p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        {/* Runner command deck */}
        <header className="relative overflow-hidden rounded-2xl border border-border/70 bg-card px-4 py-4 shadow-sm sm:px-6">
          <div className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-primary" />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={selectedId} onValueChange={setSelectedId} disabled={isRunning}>
                <SelectTrigger className="h-9 w-full max-w-xs border-0 bg-muted/50 font-semibold text-base shadow-none focus:ring-2 focus:ring-primary/30">
                  <SelectValue placeholder={t("runner.selectCollection")} />
                </SelectTrigger>
                <SelectContent>
                  {collections.length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      {t("runner.noCollections")}
                    </div>
                  )}
                  {collections.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <span className="font-medium">{c.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        ({c.requests?.length ?? 0})
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Badge
                variant="outline"
                className="gap-1.5 rounded-full font-mono text-[10px] uppercase tracking-wider"
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    isRunning ? "animate-pulse bg-warning" : "bg-success",
                  )}
                />
                Runner
              </Badge>
            </div>
            <p className="mt-2 max-w-2xl text-xs leading-relaxed text-muted-foreground">
              {t("runner.description")}
            </p>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3 sm:absolute sm:right-6 sm:top-1/2 sm:mt-0 sm:-translate-y-1/2 sm:border-0 sm:pt-0">
            <EnvironmentSelector />
            {report && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsModalOpen(true)}
                className="gap-1.5 text-xs"
              >
                <ListChecks className="size-3.5 text-primary" />
                Voir le résultat
              </Button>
            )}
          </div>
        </header>

        {/* Live run brief: a status strip instead of another dashboard card */}
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border/70 bg-border/70 sm:grid-cols-4">
          <div className="bg-card px-3 py-3 sm:px-4">
            <span className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Sélection
            </span>
            <span className="mt-1 block font-mono text-lg font-semibold text-foreground">
              {selectedCount}
              <span className="text-xs font-normal text-muted-foreground">
                {" "}
                / {totalCollectionRequests}
              </span>
            </span>
          </div>
          <div className="bg-card px-3 py-3 sm:px-4">
            <span className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              État
            </span>
            <span
              className={cn(
                "mt-1 block text-sm font-semibold",
                isRunning
                  ? "text-warning"
                  : report
                    ? hasFailures
                      ? "text-destructive"
                      : "text-success"
                    : "text-muted-foreground",
              )}
            >
              {isRunning
                ? "En cours"
                : report
                  ? hasFailures
                    ? "À vérifier"
                    : "Prêt"
                  : "En attente"}
            </span>
          </div>
          <div className="bg-card px-3 py-3 sm:px-4">
            <span className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Requêtes
            </span>
            <span className="mt-1 block font-mono text-lg font-semibold text-foreground">
              {report?.results.length ?? 0}
            </span>
          </div>
          <div className="bg-card px-3 py-3 sm:px-4">
            <span className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Durée
            </span>
            <span className="mt-1 block font-mono text-sm font-semibold text-foreground">
              {report?.totalDurationMs != null ? formatDuration(report.totalDurationMs) : "—"}
            </span>
          </div>
        </div>

        {/* Control-room layout: sequence first, settings second */}
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
          {/* Left Column: Run Sequence Checklist with Drag-and-Drop & Folders */}
          <Card className="overflow-hidden border-border/70 shadow-sm lg:col-span-7">
            <CardHeader className="border-b border-border/70 bg-card px-4 py-4 pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <ListChecks className="size-4" />
                  </span>
                  <span>{t("runner.runSequence")}</span>
                  <Badge
                    variant="outline"
                    className="hidden text-[10px] gap-1 font-mono sm:inline-flex"
                  >
                    <ArrowUpDown className="size-3" />
                    Drag & Drop
                  </Badge>
                </CardTitle>
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={handleDeselectAll}
                    className="text-primary hover:underline font-medium"
                    disabled={isRunning}
                  >
                    Deselect All
                  </button>
                  <span className="text-muted-foreground">•</span>
                  <button
                    type="button"
                    onClick={handleSelectAll}
                    className="text-primary hover:underline font-medium"
                    disabled={isRunning}
                  >
                    Select All
                  </button>
                  <span className="text-muted-foreground">•</span>
                  <button
                    type="button"
                    onClick={handleResetSequence}
                    className="text-primary hover:underline font-medium"
                    disabled={isRunning}
                  >
                    Reset
                  </button>
                </div>
              </div>
              <CardDescription className="mt-2 flex items-center justify-between text-xs">
                <span>Glissez pour réordonner, cochez pour inclure</span>
                <span className="font-mono text-[11px] font-semibold text-foreground">
                  {selectedCount} / {totalCollectionRequests} sélectionnée
                  {selectedCount > 1 ? "s" : ""}
                </span>
              </CardDescription>
            </CardHeader>

            <CardContent className="max-h-[620px] space-y-1 overflow-y-auto bg-muted/10 p-3 hide-scrollbar">
              {orderedRequests.length === 0 ? (
                <div className="p-8 text-center text-xs text-muted-foreground">
                  {t("runner.noRequests")}
                </div>
              ) : (
                <>
                  {/* Folders tree rendering */}
                  {collectionFolders.map((folder) => {
                    const requestsInFolder = orderedRequests.filter(
                      (r) => r.folderId === folder.id,
                    );
                    if (requestsInFolder.length === 0) return null;
                    const isFolderExpanded = expandedFolderIds.has(folder.id);
                    const folderChecked = requestsInFolder.every((r) =>
                      selectedRequestIds.has(r.id),
                    );

                    return (
                      <div
                        key={folder.id}
                        className="mb-2 border rounded-md overflow-hidden bg-muted/10"
                      >
                        <div className="flex items-center gap-2 p-2 bg-muted/30 border-b text-xs font-semibold">
                          <button
                            type="button"
                            onClick={() => toggleFolderExpand(folder.id)}
                            className="p-0.5 hover:bg-muted rounded"
                          >
                            {isFolderExpanded ? (
                              <ChevronDown className="size-3.5 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="size-3.5 text-muted-foreground" />
                            )}
                          </button>
                          <input
                            type="checkbox"
                            checked={folderChecked}
                            onChange={() =>
                              toggleFolderRequestsSelection(folder.id, requestsInFolder)
                            }
                            onClick={(e) => e.stopPropagation()}
                            disabled={isRunning}
                            aria-label={folder.name}
                            className="rounded border-border text-primary size-3.5"
                          />
                          {isFolderExpanded ? (
                            <FolderOpen className="size-4 text-amber-500" />
                          ) : (
                            <Folder className="size-4 text-amber-500" />
                          )}
                          <span className="truncate flex-1 text-foreground">{folder.name}</span>
                          <span className="text-[11px] font-mono text-muted-foreground">
                            ({requestsInFolder.length})
                          </span>
                        </div>

                        {isFolderExpanded && (
                          <div className="p-1 pl-4 space-y-1">
                            {requestsInFolder.map((req) => {
                              const isChecked = selectedRequestIds.has(req.id);
                              const methodClass = methodText[req.method] ?? "text-muted-foreground";

                              return (
                                <div
                                  key={req.id}
                                  draggable={!isRunning}
                                  onDragStart={(e) => handleDragStart(req.id, e)}
                                  onDragOver={(e) => handleDragOver(e, req.id)}
                                  onDrop={(e) => handleDrop(e, req.id)}
                                  onDragEnd={handleDragEnd}
                                  onClick={() => !isRunning && toggleRequestSelection(req.id)}
                                  className={cn(
                                    "flex items-center gap-2 p-1.5 rounded border text-xs transition-colors cursor-pointer select-none",
                                    isChecked
                                      ? "bg-card border-border hover:bg-muted/40"
                                      : "bg-muted/10 border-transparent opacity-60 hover:opacity-100",
                                    draggedRequestId === req.id &&
                                      "opacity-40 border-primary border-dashed",
                                    dropTargetId === req.id &&
                                      "border-primary bg-primary/5 shadow-sm ring-1 ring-primary/20",
                                  )}
                                  data-drop-target={dropTargetId === req.id}
                                >
                                  <GripVertical className="size-3 text-muted-foreground/40 shrink-0 cursor-grab" />
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => toggleRequestSelection(req.id)}
                                    onClick={(e) => e.stopPropagation()}
                                    disabled={isRunning}
                                    aria-label={req.name}
                                    className="rounded border-border text-primary size-3 shrink-0"
                                  />
                                  <span
                                    className={cn(
                                      "font-mono text-[10px] font-bold shrink-0 w-10",
                                      methodClass,
                                    )}
                                  >
                                    {req.method}
                                  </span>
                                  <span className="font-medium text-foreground truncate flex-1 min-w-0">
                                    {req.name}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Top-level requests outside folders */}
                  <div className="space-y-1">
                    {orderedRequests
                      .filter(
                        (r) => !r.folderId || !collectionFolders.some((f) => f.id === r.folderId),
                      )
                      .map((req) => {
                        const globalIdx = orderedRequests.findIndex((r) => r.id === req.id);
                        const isChecked = selectedRequestIds.has(req.id);
                        const methodClass = methodText[req.method] ?? "text-muted-foreground";

                        return (
                          <div
                            key={req.id}
                            draggable={!isRunning}
                            onDragStart={(e) => handleDragStart(req.id, e)}
                            onDragOver={(e) => handleDragOver(e, req.id)}
                            onDrop={(e) => handleDrop(e, req.id)}
                            onDragEnd={handleDragEnd}
                            onClick={() => !isRunning && toggleRequestSelection(req.id)}
                            className={cn(
                              "flex items-center gap-2.5 p-2 rounded-md border text-xs transition-colors cursor-pointer select-none",
                              isChecked
                                ? "bg-card border-border hover:bg-muted/40"
                                : "bg-muted/10 border-transparent opacity-60 hover:opacity-100",
                              draggedRequestId === req.id &&
                                "opacity-40 border-primary border-dashed",
                              dropTargetId === req.id &&
                                "border-primary bg-primary/5 shadow-sm ring-1 ring-primary/20",
                            )}
                            data-drop-target={dropTargetId === req.id}
                          >
                            <span className="font-mono text-[11px] text-muted-foreground w-4 text-right shrink-0">
                              {globalIdx + 1}
                            </span>
                            <GripVertical className="size-3.5 text-muted-foreground/40 shrink-0 cursor-grab" />
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleRequestSelection(req.id)}
                              onClick={(e) => e.stopPropagation()}
                              disabled={isRunning}
                              aria-label={req.name}
                              className="rounded border-border text-primary focus:ring-primary size-3.5 shrink-0"
                            />
                            <span
                              className={cn(
                                "font-mono text-[11px] font-bold shrink-0 w-12",
                                methodClass,
                              )}
                            >
                              {req.method}
                            </span>
                            <span className="font-medium text-foreground truncate flex-1 min-w-0">
                              {req.name}
                            </span>
                            {req.runnerAssertions && req.runnerAssertions.length > 0 && (
                              <Badge
                                variant="outline"
                                className="text-[10px] py-0 px-1 font-mono shrink-0"
                              >
                                {req.runnerAssertions.length} assert
                              </Badge>
                            )}
                          </div>
                        );
                      })}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Right Column: Configuration & Settings */}
          <div className="space-y-4 lg:col-span-5 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-2 scrollbar-discreet">
            {/* Feature 3: Run Type Selection & Performance Concurrency */}
            <Card className="shadow-sm border-border">
              <CardContent className="p-4 space-y-4">
                <div>
                  <Label className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2 block">
                    Run type
                  </Label>
                  <div className="grid grid-cols-2 gap-3">
                    <label
                      className={cn(
                        "flex items-start gap-2.5 p-3 rounded-lg border text-xs cursor-pointer transition-all",
                        runType === "functional"
                          ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                          : "border-border bg-card hover:bg-muted/30",
                      )}
                    >
                      <input
                        type="radio"
                        name="runType"
                        checked={runType === "functional"}
                        onChange={() => setRunType("functional")}
                        className="mt-0.5 text-primary"
                      />
                      <div>
                        <span className="font-semibold text-foreground block flex items-center gap-1.5">
                          <Zap className="size-3.5 text-amber-500" />
                          Functional
                        </span>
                        <span className="text-[11px] text-muted-foreground leading-tight block mt-0.5">
                          Validate request correctness and test assertions
                        </span>
                      </div>
                    </label>

                    <label
                      className={cn(
                        "flex items-start gap-2.5 p-3 rounded-lg border text-xs cursor-pointer transition-all",
                        runType === "performance"
                          ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                          : "border-border bg-card hover:bg-muted/30",
                      )}
                    >
                      <input
                        type="radio"
                        name="runType"
                        checked={runType === "performance"}
                        onChange={() => setRunType("performance")}
                        className="mt-0.5 text-primary"
                      />
                      <div>
                        <span className="font-semibold text-foreground block flex items-center gap-1.5">
                          <Gauge className="size-3.5 text-blue-500" />
                          Performance
                        </span>
                        <span className="text-[11px] text-muted-foreground leading-tight block mt-0.5">
                          Measure response times and load concurrency
                        </span>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Performance Virtual Users if Performance mode selected */}
                {runType === "performance" && (
                  <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg text-xs space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
                        <Activity className="size-3.5" />
                        Virtual Users (Concurrent Workers)
                      </span>
                      <span className="font-mono font-bold text-foreground">
                        {virtualUsers} VUs
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {[4, 10, 25, 50].map((vu) => (
                        <button
                          key={vu}
                          type="button"
                          onClick={() => setVirtualUsers(vu)}
                          className={cn(
                            "px-2.5 py-1 rounded text-xs font-mono font-medium border transition-all",
                            virtualUsers === vu
                              ? "bg-blue-600 text-white border-blue-600 shadow-xs"
                              : "bg-card border-border hover:bg-muted",
                          )}
                        >
                          {vu} VUs
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Iterations & Dataset */}
                <div className="grid grid-cols-2 gap-3 pt-2 border-t">
                  <div>
                    <Label className="text-xs font-medium text-foreground mb-1 block">
                      Iterations
                    </Label>
                    <Input
                      type="number"
                      min="1"
                      max="100"
                      value={iterationsCount}
                      onChange={(e) => setIterationsCount(Math.max(1, Number(e.target.value)))}
                      className="h-8 text-xs font-mono"
                      disabled={isRunning}
                    />
                  </div>

                  <div>
                    <Label className="text-xs font-medium text-foreground mb-1 block">
                      Iteration data
                    </Label>
                    <div className="flex items-center gap-1.5">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".json,.csv"
                        onChange={handleFileUpload}
                        className="hidden"
                      />
                      {datasetRows.length > 0 ? (
                        <div className="flex-1 flex items-center justify-between bg-emerald-500/10 border border-emerald-500/30 rounded px-2 h-8 text-xs">
                          <span className="font-mono text-emerald-600 dark:text-emerald-400 font-semibold truncate">
                            {datasetRows.length} rows
                          </span>
                          <button
                            type="button"
                            onClick={handleClearDataset}
                            className="text-destructive hover:underline text-[11px]"
                          >
                            <Trash2 className="size-3" />
                          </button>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => fileInputRef.current?.click()}
                          className="w-full h-8 text-xs gap-1.5 border-dashed"
                          disabled={isRunning}
                        >
                          <Upload className="size-3" />
                          Upload CSV / JSON
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Feature 4: Visual Variable Extraction (No-Code Chaining Builder) */}
            <Card className="shadow-sm border-border">
              <CardHeader className="pb-2 pt-3 px-4 flex flex-row items-center justify-between">
                <CardTitle className="text-xs font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="size-3.5 text-amber-500" />
                  Extract Variables (No-Code Chaining)
                </CardTitle>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addExtractionRule}
                  className="h-6 text-[11px] px-2 gap-1"
                >
                  <Plus className="size-3" />
                  Extraire
                </Button>
              </CardHeader>
              <CardContent className="px-4 pb-3 space-y-2 text-xs">
                {extractions.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground italic">
                    Aucune règle d'extraction. Ex: extraction automatique de token depuis la
                    réponse.
                  </p>
                ) : (
                  extractions.map((rule) => (
                    <div
                      key={rule.id}
                      className="flex items-center gap-2 p-2 border rounded-md bg-muted/20"
                    >
                      <Select
                        value={rule.source}
                        onValueChange={(v) =>
                          updateExtractionRule(rule.id, {
                            source: v as VariableExtractionRule["source"],
                          })
                        }
                      >
                        <SelectTrigger className="w-24 h-7 text-[11px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="jsonPath">JSONPath</SelectItem>
                          <SelectItem value="header">Header</SelectItem>
                          <SelectItem value="status">Status</SelectItem>
                        </SelectContent>
                      </Select>

                      <Input
                        placeholder={rule.source === "jsonPath" ? "$.token" : "x-auth-token"}
                        value={rule.path}
                        onChange={(e) => updateExtractionRule(rule.id, { path: e.target.value })}
                        className="flex-1 h-7 text-[11px] font-mono"
                      />

                      <span className="text-[11px] font-bold text-muted-foreground">→</span>

                      <Input
                        placeholder="authToken"
                        value={rule.variableName}
                        onChange={(e) =>
                          updateExtractionRule(rule.id, { variableName: e.target.value })
                        }
                        className="w-28 h-7 text-[11px] font-mono"
                      />

                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeExtractionRule(rule.id)}
                        className="size-7 text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {/* Settings Checkboxes */}
            <Card className="shadow-sm border-border">
              <CardHeader className="pb-2 pt-3 px-4">
                <CardTitle className="text-xs font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Settings className="size-3.5 text-primary" />
                  Settings
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-2.5 text-xs">
                <div className="flex items-center gap-2">
                  <Label className="text-[11px] font-medium text-foreground min-w-20">
                    {t("runner.executionMode")}
                  </Label>
                  <Select
                    value={runMethod}
                    onValueChange={(value) => setRunMethod(value as "local" | "proxy")}
                    disabled={isRunning}
                  >
                    <SelectTrigger className="h-7 w-28 text-[11px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="local">Local</SelectItem>
                      <SelectItem value="proxy">Proxy</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={stopOnFailure}
                    onChange={(e) => setStopOnFailure(e.target.checked)}
                    disabled={isRunning}
                    className="rounded border-border text-primary"
                  />
                  <span>{t("runner.stopOnError")}</span>
                </label>

                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    id="delayCheck"
                    checked={delayMs > 0}
                    onChange={(e) => setDelayMs(e.target.checked ? 500 : 0)}
                    disabled={isRunning}
                    className="rounded border-border text-primary"
                  />
                  <label htmlFor="delayCheck" className="cursor-pointer select-none">
                    Add a delay of
                  </label>
                  <Input
                    type="number"
                    min="0"
                    max="10000"
                    step="100"
                    value={delayMs}
                    onChange={(e) => setDelayMs(Math.max(0, Number(e.target.value)))}
                    disabled={isRunning}
                    className="w-20 h-7 text-xs font-mono text-center inline-block"
                  />
                  <span>ms between requests</span>
                </div>
              </CardContent>
            </Card>

            {/* Big Prominent Start Run Action Button */}
            <Button
              onClick={handleRun}
              disabled={!canRun}
              className="w-full h-12 text-base font-bold gap-2 shadow-md bg-orange-600 hover:bg-orange-500 text-white rounded-lg transition-all"
            >
              <Play className="size-5 fill-current" />
              Start run ({selectedCount} request{selectedCount > 1 ? "s" : ""})
            </Button>
          </div>
        </div>

        {/* Execution & Results Modal */}
        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col p-0 overflow-hidden">
            <DialogHeader className="p-4 border-b bg-card flex flex-row items-center justify-between">
              <div className="flex items-center gap-3">
                {isRunning ? (
                  <div className="size-8 rounded-full bg-orange-500/10 flex items-center justify-center animate-spin text-orange-600">
                    <Zap className="size-4" />
                  </div>
                ) : hasFailures ? (
                  <div className="size-8 rounded-full bg-destructive/10 flex items-center justify-center text-destructive">
                    <XCircle className="size-5" />
                  </div>
                ) : (
                  <div className="size-8 rounded-full bg-success/10 flex items-center justify-center text-success">
                    <CheckCircle2 className="size-5" />
                  </div>
                )}
                <div>
                  <DialogTitle className="text-base font-bold flex items-center gap-2">
                    {selected?.name} —{" "}
                    {runType === "performance" ? "Performance Report" : "Run Results"}
                  </DialogTitle>
                  <DialogDescription className="text-xs flex items-center gap-2 mt-0.5">
                    <span>{report?.results.length ?? 0} requêtes</span>
                    {report?.totalDurationMs != null && (
                      <>
                        <span>•</span>
                        <span className="font-mono">{formatDuration(report.totalDurationMs)}</span>
                      </>
                    )}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            {/* Body Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Live Running State */}
              {isRunning && (
                <div className="space-y-3 bg-muted/30 p-4 rounded-xl border">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span className="text-foreground flex items-center gap-2">
                      <Zap className="size-4 text-orange-500 animate-pulse" />
                      Exécution en cours (
                      {runType === "performance" ? `${virtualUsers} VUs` : "Functional"})...
                    </span>
                    <span className="font-mono text-primary font-bold">{progress}%</span>
                  </div>
                  <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-orange-500 transition-all duration-300 rounded-full"
                      style={{ width: `${Math.max(5, progress)}%` }}
                    />
                  </div>
                  {currentExecutingName && (
                    <p className="text-xs text-muted-foreground font-mono flex items-center gap-1.5">
                      <ChevronRight className="size-3 text-orange-500" />
                      {t("runner.currentlyExecuting")}{" "}
                      <span className="text-foreground font-medium">{currentExecutingName}</span>
                    </p>
                  )}
                  <div className="flex justify-end pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCancel}
                      className="text-xs gap-1.5 text-destructive"
                    >
                      <CircleSlash className="size-3.5" />
                      {t("common.cancel")}
                    </Button>
                  </div>
                </div>
              )}

              {/* Error Message (shown even when a previous report exists, e.g. re-run failure) */}
              {error && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                  {error}
                </div>
              )}

              {/* Feature 3: Performance Dashboard Card if report.performanceReport exists */}
              {report?.performanceReport && (
                <Card className="bg-blue-500/5 border-blue-500/30">
                  <CardHeader className="pb-2 pt-3 px-4">
                    <CardTitle className="text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider flex items-center gap-2">
                      <BarChart3 className="size-4" />
                      Performance Dashboard ({report.performanceReport.virtualUsers} VUs
                      Concurrents)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                      <div className="p-3 bg-card rounded-lg border">
                        <span className="text-[11px] text-muted-foreground block">Throughput</span>
                        <span className="text-xl font-bold font-mono text-blue-600 dark:text-blue-400">
                          {report.performanceReport.throughputRps}{" "}
                          <span className="text-xs">req/s</span>
                        </span>
                      </div>
                      <div className="p-3 bg-card rounded-lg border">
                        <span className="text-[11px] text-muted-foreground block">
                          {t("runner.avgLatency")}
                        </span>
                        <span className="text-xl font-bold font-mono text-foreground">
                          {report.performanceReport.avgLatencyMs}{" "}
                          <span className="text-xs">ms</span>
                        </span>
                      </div>
                      <div className="p-3 bg-card rounded-lg border">
                        <span className="text-[11px] text-muted-foreground block">
                          {t("runner.minMax")}
                        </span>
                        <span className="text-sm font-bold font-mono text-foreground mt-1 block">
                          {report.performanceReport.minLatencyMs} /{" "}
                          {report.performanceReport.maxLatencyMs} ms
                        </span>
                      </div>
                      <div className="p-3 bg-card rounded-lg border">
                        <span className="text-[11px] text-muted-foreground block">
                          {t("runner.errorRate")}
                        </span>
                        <span
                          className={cn(
                            "text-xl font-bold font-mono",
                            report.performanceReport.errorRatePercent > 0
                              ? "text-destructive"
                              : "text-success",
                          )}
                        >
                          {report.performanceReport.errorRatePercent}%
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Report Summary Cards & Results List */}
              {report && (
                <div className="space-y-4">
                  {/* Summary Metric Cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {(["pass", "fail", "errored", "skipped"] as AssertionStatus[]).map((k) => {
                      const m = STATUS_META[k];
                      const count =
                        k === "pass"
                          ? (summary?.passed ?? 0)
                          : k === "fail"
                            ? (summary?.failed ?? 0)
                            : k === "errored"
                              ? (summary?.errored ?? 0)
                              : (summary?.skipped ?? 0);
                      const Icon = m.icon;

                      return (
                        <div
                          key={k}
                          onClick={() => setFilterTab(k === filterTab ? "all" : k)}
                          className={cn(
                            "rounded-lg border p-3 cursor-pointer transition-all",
                            filterTab === k
                              ? "ring-2 ring-primary border-primary bg-muted/40"
                              : "bg-card hover:bg-muted/20",
                          )}
                        >
                          <div className="flex items-center gap-1.5">
                            <span className={cn("size-2 rounded-full", m.dot)} />
                            <span className="text-xs text-muted-foreground">{t(m.labelKey)}</span>
                          </div>
                          <p className="mt-1 flex items-center gap-1.5 text-xl font-bold text-foreground">
                            <Icon className={cn("size-4", m.color)} />
                            {count}
                          </p>
                        </div>
                      );
                    })}
                  </div>

                  {/* Filter Tabs */}
                  <Tabs value={filterTab} onValueChange={setFilterTab} className="w-full">
                    <TabsList className="h-8 text-xs bg-muted/50 p-0.5">
                      <TabsTrigger value="all" className="text-xs h-7">
                        Tous ({results.length})
                      </TabsTrigger>
                      <TabsTrigger value="pass" className="text-xs h-7 text-success">
                        Passed ({summary?.passed ?? 0})
                      </TabsTrigger>
                      <TabsTrigger value="fail" className="text-xs h-7 text-destructive">
                        Failed ({(summary?.failed ?? 0) + (summary?.errored ?? 0)})
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>

                  {/* Request Results List */}
                  <div className="space-y-1">
                    {filteredResults.length === 0 ? (
                      <p className="text-xs text-muted-foreground p-4 text-center">
                        Aucune requête dans ce filtre.
                      </p>
                    ) : (
                      <Accordion type="multiple" className="w-full">
                        {filteredResults.map((res) => (
                          <RequestResultItem
                            key={res.requestId}
                            result={res}
                            accordionValue={`item-${res.requestId}`}
                          />
                        ))}
                      </Accordion>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <DialogFooter className="p-3 border-t bg-muted/20 flex flex-row items-center justify-between sm:justify-between">
              <div className="flex items-center gap-2">
                {report && hasFailures && !isRunning && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={reRunFailed}
                    className="gap-1.5 text-xs text-destructive border-destructive/30"
                  >
                    <RotateCcw className="size-3.5" />
                    Re-run Failed
                  </Button>
                )}
                {report && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => exportReport("json")}
                      className="gap-1 text-xs"
                    >
                      <Download className="size-3.5" />
                      JSON
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => exportReport("junit")}
                      className="gap-1 text-xs"
                    >
                      <Download className="size-3.5" />
                      JUnit
                    </Button>
                  </>
                )}
              </div>

              <Button
                variant="secondary"
                size="sm"
                onClick={() => setIsModalOpen(false)}
                className="text-xs"
              >
                Fermer
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </main>
  );
}

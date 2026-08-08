"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
  ListChecks,
  Terminal,
  CircleSlash,
  Upload,
  FileText,
  Database,
  Table2,
  HardDrive,
  Trash2,
  Download,
  RotateCcw,
  Search,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useRequestStore, type Collection } from "@/hooks/use-request-store";
import { runCollection as runCollectionEngine, type RunnerOptions } from "@/lib/test-runner/runner";
import { createRunnerExecutor } from "@/lib/test-runner/executor";
import { loadJsonDataset, loadCsvDataset } from "@/lib/test-runner/data-driven";
import {
  type CollectionRunReport,
  type RequestTestResult,
  type AssertionResult,
  type Assertion,
  type AssertionStatus,
  type RunnerContext,
} from "@/lib/test-runner/types";
import { hashRunReport, verifyRunReport } from "@/lib/run-report/hash";
import { EnvironmentSelector } from "@/components/environment-selector";

function formatDuration(ms?: number) {
  if (ms == null) return "\u2014";
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
  { label: string; icon: LucideIcon; color: string; dot: string }
> = {
  pass: { label: "Passed", icon: CheckCircle2, color: "text-success", dot: "bg-success" },
  fail: { label: "Failed", icon: XCircle, color: "text-destructive", dot: "bg-destructive" },
  skipped: {
    label: "Skipped",
    icon: CircleSlash,
    color: "text-muted-foreground",
    dot: "bg-muted-foreground",
  },
  errored: { label: "Errored", icon: AlertCircle, color: "text-warning", dot: "bg-warning" },
};

const COUNT_KEY: Record<AssertionStatus, "passed" | "failed" | "errored" | "skipped"> = {
  pass: "passed",
  fail: "failed",
  errored: "errored",
  skipped: "skipped",
};

function describeAssertion(a: Assertion): string {
  switch (a.type) {
    case "status": {
      if (typeof a.expected === "number") return `Status equals ${a.expected}`;
      if ("in" in a.expected) return `Status in [${a.expected.in.join(", ")}]`;
      return `Status not ${a.expected.not}`;
    }
    case "responseTime":
      return `Response time ${a.operator} ${a.valueMs}ms`;
    case "jsonPath": {
      const op =
        a.operator === "exists"
          ? "exists"
          : a.operator === "notExists"
            ? "does not exist"
            : a.operator === "equals"
              ? `equals ${JSON.stringify(a.value)}`
              : a.operator === "contains"
                ? `contains ${JSON.stringify(a.value)}`
                : a.operator;
      return `JSONPath ${a.path} ${op}`;
    }
    case "schema":
      return "Schema validation";
    default:
      return "Assertion";
  }
}

function formatActual(v: unknown): string {
  if (v == null) return "\u2014";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "string") return v;
  try {
    const str = JSON.stringify(v);
    return str.length > 80 ? str.slice(0, 80) + "\u2026" : str;
  } catch {
    return String(v);
  }
}

function RequestResult({
  result,
  accordionValue,
}: {
  result: RequestTestResult;
  accordionValue: string;
}) {
  const meta = STATUS_META[result.status];
  const StatusIcon = meta.icon;
  const hasScript = !!(result.scriptOutput?.pre || result.scriptOutput?.post);
  const hasAssertions = result.assertionResults.length > 0;

  return (
    <AccordionItem value={accordionValue} className="px-4">
      <AccordionTrigger className="items-center gap-3 hover:no-underline">
        <span className={cn("size-2 rounded-full shrink-0", meta.dot)} />
        <span className="flex-1 min-w-0 truncate font-medium text-foreground">
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
      <AccordionContent className="pb-4">
        {result.error && (
          <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive font-mono">
            {result.error}
          </div>
        )}
        {hasAssertions && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Assertions
            </p>
            <div className="divide-y divide-border rounded-lg border border-border bg-muted/20">
              {result.assertionResults.map((ar: AssertionResult, i: number) => (
                <div key={i} className="flex items-start gap-2.5 px-3 py-2">
                  {ar.passed ? (
                    <CheckCircle2 className="size-4 text-success shrink-0 translate-y-0.5" />
                  ) : (
                    <XCircle className="size-4 text-destructive shrink-0 translate-y-0.5" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground">{describeAssertion(ar.assertion)}</p>
                    {ar.error ? (
                      <p className="font-mono text-xs text-destructive/80 truncate">{ar.error}</p>
                    ) : (
                      <p className="font-mono text-xs text-muted-foreground truncate">
                        actual: {formatActual(ar.actualValue)}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {!hasAssertions && !hasScript && !result.error && (
          <p className="text-xs text-muted-foreground">
            No assertions or scripts configured for this request.
          </p>
        )}
        {hasScript && (
          <div className="mt-3 space-y-2">
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Terminal className="size-3.5" />
              Script output
            </p>
            {result.scriptOutput?.pre && (
              <pre className="overflow-auto rounded-lg border border-border bg-[var(--code-bg)] p-3 font-mono text-xs text-[var(--code-text)]">
                {result.scriptOutput.pre}
              </pre>
            )}
            {result.scriptOutput?.post && (
              <pre className="overflow-auto rounded-lg border border-border bg-[var(--code-bg)] p-3 font-mono text-xs text-[var(--code-text)]">
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
  const { collections, environmentVariables, activeWorkspaceId } = useRequestStore();
  const [selectedId, setSelectedId] = useState<string>("");
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [report, setReport] = useState<CollectionRunReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [integrity, setIntegrity] = useState<"idle" | "valid" | "tampered">("idle");

  const [datasetText, setDatasetText] = useState("");
  const [datasetRows, setDatasetRows] = useState<Record<string, string>[]>([]);
  const [datasetError, setDatasetError] = useState<string | null>(null);
  const [datasetFileName, setDatasetFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [filterTab, setFilterTab] = useState<string>("all");

  const reportHash = useMemo(() => (report ? hashRunReport(report) : ""), [report]);

  const selected: Collection | null = collections.find((c) => c.id === selectedId) ?? null;
  const requestCount = selected?.requests?.length ?? 0;
  const canRun = !!selected && requestCount > 0 && !isRunning;

  const executor = useMemo(
    () => createRunnerExecutor({ workspaceId: activeWorkspaceId }),
    [activeWorkspaceId],
  );

  const baseContext = useMemo<RunnerContext>(
    () => ({
      environment: environmentVariables ?? {},
      iterationData: {},
      iterationIndex: 0,
      log: () => {},
    }),
    [environmentVariables],
  );

  const iterations = useMemo<RunnerContext[] | undefined>(() => {
    if (datasetRows.length === 0) return undefined;
    return datasetRows.map((row, i) => ({
      environment: environmentVariables ?? {},
      iterationData: row,
      iterationIndex: i,
      log: () => {},
    }));
  }, [datasetRows, environmentVariables]);

  const handleLoadDataset = useCallback(() => {
    setDatasetError(null);
    const trimmed = datasetText.trim();
    if (!trimmed) {
      setDatasetError("Please paste JSON or CSV data, or upload a file.");
      return;
    }
    try {
      setDatasetRows(loadJsonDataset(trimmed));
      setDatasetFileName(null);
      return;
    } catch {
      /* fall through */
    }
    try {
      const rows = loadCsvDataset(trimmed);
      if (rows.length === 0) {
        setDatasetError("No rows found in CSV data.");
        return;
      }
      setDatasetRows(rows);
      setDatasetFileName(null);
    } catch (e) {
      setDatasetError(e instanceof Error ? e.message : "Failed to parse dataset.");
    }
  }, [datasetText]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
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
          setDatasetError("No rows found in CSV data.");
          return;
        }
        setDatasetRows(rows);
      } catch (e) {
        setDatasetError(e instanceof Error ? e.message : "Failed to parse dataset.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }, []);

  const handleClearDataset = useCallback(() => {
    setDatasetText("");
    setDatasetRows([]);
    setDatasetError(null);
    setDatasetFileName(null);
  }, []);

  const columnNames = useMemo(() => {
    if (datasetRows.length === 0) return [];
    return Object.keys(datasetRows[0]);
  }, [datasetRows]);

  const handleRun = useCallback(async () => {
    if (!selected) return;
    setIsRunning(true);
    setProgress(0);
    setReport(null);
    setError(null);
    setFilterTab("all");
    try {
      const opts: RunnerOptions = { executor };
      if (iterations) opts.iterations = iterations;
      const result = await runCollectionEngine(selected, baseContext, opts);
      setReport(result);
      setProgress(100);
      setIntegrity("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunning(false);
    }
  }, [selected, baseContext, executor, iterations]);

  const reRunFailed = useCallback(async () => {
    if (!selected || !report) return;
    const failedIds = new Set(
      report.results
        .filter((r) => r.status === "fail" || r.status === "errored")
        .map((r) => r.requestId),
    );
    const failedRequests = selected.requests?.filter((r) => failedIds.has(r.id)) ?? [];
    if (failedRequests.length === 0) return;
    setIsRunning(true);
    setProgress(0);
    setFilterTab("all");
    try {
      const result = await runCollectionEngine(
        { ...selected, requests: failedRequests } as Collection,
        baseContext,
        { executor, iterations },
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
      setProgress(100);
      setIntegrity("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunning(false);
    }
  }, [selected, report, baseContext, executor, iterations]);

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
  const total = summary?.total ?? 0;
  const hasFailures = (summary?.failed ?? 0) + (summary?.errored ?? 0) > 0;
  const verdictIcon: LucideIcon = !report ? ListChecks : hasFailures ? XCircle : CheckCircle2;
  const VerdictIcon = verdictIcon;
  const verdictColor = !report
    ? "text-muted-foreground"
    : hasFailures
      ? "text-destructive"
      : "text-success";
  const verdictAccent = !report
    ? "from-muted/20 to-transparent"
    : hasFailures
      ? "from-destructive/15 to-transparent"
      : "from-success/15 to-transparent";
  const verdictText = !report
    ? "No runs yet"
    : hasFailures
      ? `${summary?.failed ?? 0} failed \u00B7 ${summary?.errored ?? 0} errored`
      : "All checks passed";

  const segments = summary
    ? [
        { v: summary.passed, color: "bg-success" },
        { v: summary.failed, color: "bg-destructive" },
        { v: summary.errored, color: "bg-warning" },
        { v: summary.skipped, color: "bg-muted-foreground" },
      ].filter((s) => s.v > 0)
    : [];

  const results = useMemo(() => report?.results ?? [], [report]);
  const filteredResults = useMemo(() => {
    if (filterTab === "all") return results;
    return results.filter((r) => r.status === filterTab);
  }, [results, filterTab]);

  return (
    <main className="flex-1 overflow-auto p-6 hide-scrollbar">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Runner</h1>
            <p className="text-sm text-muted-foreground">
              Execute an entire collection and verify every assertion in one pass.
            </p>
          </div>
        </header>

        <Card>
          <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-1 items-center gap-3 min-w-0 flex-wrap">
              <Select value={selectedId} onValueChange={setSelectedId} disabled={isRunning}>
                <SelectTrigger className="w-full sm:w-64">
                  <SelectValue placeholder="Select a collection\u2026" />
                </SelectTrigger>
                <SelectContent>
                  {collections.length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      No collections available
                    </div>
                  )}
                  {collections.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <span className="truncate">{c.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {c.requests?.length ?? 0}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <EnvironmentSelector />
              <span className="shrink-0 text-xs text-muted-foreground">
                {requestCount > 0
                  ? `${requestCount} request${requestCount !== 1 ? "s" : ""}`
                  : "No requests"}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {isRunning ? (
                <Button variant="outline" disabled className="gap-2">
                  <Loader2 className="size-4 animate-spin" />
                  Running\u2026
                </Button>
              ) : (
                <Button onClick={handleRun} disabled={!canRun} className="gap-2">
                  <Play className="size-4" />
                  Run collection
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-emerald-500/10">
                  <Database className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <h2 className="text-sm font-medium text-foreground">
                  Dataset{" "}
                  <span className="text-xs font-normal text-muted-foreground">(optional)</span>
                </h2>
              </div>
              {datasetRows.length > 0 && (
                <Badge variant="secondary" className="gap-1.5 text-xs">
                  <Table2 className="size-3" />
                  {datasetRows.length} row{datasetRows.length !== 1 ? "s" : ""}
                </Badge>
              )}
            </div>
            {datasetRows.length > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">
                    Columns
                  </span>
                  {columnNames.map((col) => (
                    <Badge
                      key={col}
                      variant="outline"
                      className="text-[11px] font-mono border-emerald-200/40 dark:border-emerald-800/40"
                    >
                      {col}
                    </Badge>
                  ))}
                </div>
                {datasetFileName && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1">
                    <HardDrive className="size-3" />
                    File: <span className="font-medium text-foreground">{datasetFileName}</span>
                  </p>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 text-xs text-destructive hover:text-destructive"
                  onClick={handleClearDataset}
                  disabled={isRunning}
                >
                  <Trash2 className="size-3" />
                  Clear dataset
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <Textarea
                  placeholder={`Paste a JSON array of objects or CSV data here\u2026\n\nExample (JSON):\n[{"id":"1","name":"Alice"},{"id":"2","name":"Bob"}]\n\nExample (CSV):\nid,name\n1,Alice\n2,Bob`}
                  value={datasetText}
                  onChange={(e) => setDatasetText(e.target.value)}
                  className="min-h-24 text-xs font-mono border-dashed focus:border-emerald-500/50"
                  disabled={isRunning}
                />
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-7 gap-1.5 text-xs"
                    onClick={handleLoadDataset}
                    disabled={isRunning || !datasetText.trim()}
                  >
                    <Upload className="size-3" />
                    Load dataset
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json,.csv"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5 text-xs"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isRunning}
                  >
                    <FileText className="size-3" />
                    Upload .json/.csv
                  </Button>
                </div>
                {datasetError && (
                  <p className="text-xs text-destructive flex items-center gap-1">
                    <AlertCircle className="size-3" />
                    {datasetError}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {(isRunning || progress === 100) && (
          <div className="space-y-1">
            <div className="metric-bar">
              {isRunning ? (
                <div className="metric-bar-fill w-1/3 shimmer bg-primary/70" />
              ) : (
                <div
                  className={cn("metric-bar-fill", hasFailures ? "bg-destructive" : "bg-success")}
                  style={{ width: "100%" }}
                />
              )}
            </div>
            <p className="text-xs text-muted-foreground text-right">
              {isRunning ? "Executing requests\u2026" : "Run complete"}
            </p>
          </div>
        )}

        {error && !report && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {!report && !isRunning && !error && (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ListChecks className="size-6" />
              </EmptyMedia>
              <EmptyTitle>No runs yet</EmptyTitle>
              <EmptyDescription>
                Pick a collection above and hit{" "}
                <span className="font-medium text-foreground">Run collection</span> to execute every
                request and verify its assertions.
              </EmptyDescription>
            </EmptyHeader>
            <Button
              variant="default"
              size="sm"
              onClick={handleRun}
              disabled={!canRun}
              className="h-8 gap-1.5 text-xs font-medium shadow-xs"
            >
              <Play className="size-4" />
              {selected ? "Run collection" : "Select a collection first"}
            </Button>
          </Empty>
        )}

        {report && (
          <div className="space-y-5" key={report.startedAt}>
            <Card className="bg-card relative overflow-hidden">
              <div
                className={cn(
                  "absolute inset-x-0 top-0 h-16 bg-gradient-to-b",
                  verdictAccent,
                  "pointer-events-none",
                )}
              />
              <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2 relative">
                <CardTitle className="flex items-center gap-2 text-base">
                  <VerdictIcon className={cn("size-5", verdictColor)} />
                  <span className="text-foreground">{verdictText}</span>
                </CardTitle>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-mono text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="size-3.5" />
                    {formatDuration(report.totalDurationMs)}
                  </span>
                  <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    {report.collectionName}
                  </span>
                  {datasetRows.length > 0 && (
                    <Badge variant="secondary" className="text-[11px] gap-1">
                      <FileText className="size-3" />
                      {datasetRows.length} it
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="relative space-y-4">
                {segments.length > 0 && (
                  <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
                    {segments.map((s, i) => (
                      <div
                        key={i}
                        className={cn("h-full transition-all duration-500", s.color)}
                        style={{ width: `${(s.v / total) * 100}%` }}
                      />
                    ))}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {(["pass", "fail", "errored", "skipped"] as AssertionStatus[]).map((k) => {
                    const m = STATUS_META[k];
                    const count = summary?.[COUNT_KEY[k]] ?? 0;
                    const Icon = m.icon;
                    return (
                      <div key={k} className="rounded-lg border border-border bg-muted/20 p-3">
                        <div className="flex items-center gap-1.5">
                          <span className={cn("size-2 rounded-full", m.dot)} />
                          <span className="text-xs text-muted-foreground">{m.label}</span>
                        </div>
                        <p className="mt-1 flex items-center gap-1.5 text-xl font-bold text-foreground">
                          <Icon className={cn("size-4", m.color)} />
                          {count}
                        </p>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5 text-xs"
                    onClick={() => exportReport("json")}
                  >
                    <Download className="size-3" />
                    Export JSON
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5 text-xs"
                    onClick={() => exportReport("junit")}
                  >
                    <FileText className="size-3" />
                    Export JUnit
                  </Button>
                  {hasFailures && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1.5 text-xs border-destructive/30 text-destructive hover:text-destructive"
                      onClick={reRunFailed}
                      disabled={isRunning}
                    >
                      <RotateCcw className="size-3" />
                      Re-run failed
                    </Button>
                  )}
                </div>
                <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-muted-foreground uppercase tracking-wide">
                      Integrity Hash
                    </span>
                    <code className="font-mono text-xs text-foreground bg-muted rounded px-1.5 py-0.5 break-all">
                      {reportHash}
                    </code>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1.5 text-xs"
                      onClick={() =>
                        setIntegrity(verifyRunReport(report, reportHash) ? "valid" : "tampered")
                      }
                    >
                      Verify integrity
                    </Button>
                    {integrity === "valid" && (
                      <span className="flex items-center gap-1 text-xs font-medium text-success">
                        Report intact
                      </span>
                    )}
                    {integrity === "tampered" && (
                      <span className="flex items-center gap-1 text-xs font-medium text-destructive">
                        Report modified
                      </span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <ListChecks className="size-4 text-muted-foreground" />
                    Requests
                    <span className="text-xs font-normal text-muted-foreground">
                      {datasetRows.length > 0
                        ? `(${datasetRows.length} iteration${datasetRows.length !== 1 ? "s" : ""} \u00D7 ${requestCount} request${requestCount !== 1 ? "s" : ""})`
                        : `(${results.length})`}
                    </span>
                  </CardTitle>
                  <Tabs value={filterTab} onValueChange={setFilterTab} className="shrink-0">
                    <TabsList className="h-8">
                      <TabsTrigger value="all" className="text-xs px-2.5 h-6">
                        All
                      </TabsTrigger>
                      <TabsTrigger value="pass" className="text-xs px-2.5 h-6">
                        Passed
                      </TabsTrigger>
                      <TabsTrigger value="fail" className="text-xs px-2.5 h-6">
                        Failed
                      </TabsTrigger>
                      <TabsTrigger value="errored" className="text-xs px-2.5 h-6">
                        Errors
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {filteredResults.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-8 text-sm text-muted-foreground">
                    <Search className="size-8 text-muted-foreground/30" />
                    No{" "}
                    {filterTab !== "all"
                      ? STATUS_META[filterTab as AssertionStatus]?.label.toLowerCase()
                      : ""}{" "}
                    results
                  </div>
                ) : (
                  <Accordion type="single" collapsible className="w-full">
                    {filteredResults.map((r, i) => (
                      <RequestResult
                        key={`${r.requestId}-${i}`}
                        result={r}
                        accordionValue={`${r.requestId}-${i}`}
                      />
                    ))}
                  </Accordion>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </main>
  );
}

"use client";

import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
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
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import {
  Zap,
  Gauge,
  Activity,
  Upload,
  Trash2,
  Plus,
  Sparkles,
  Settings,
  ListChecks,
  BarChart3,
} from "lucide-react";
import { loadJsonDataset, loadCsvDataset } from "@/lib/test-runner/data-driven";
import type { VariableExtractionRule } from "@/lib/test-runner/types";

interface RunConfigPanelProps {
  runType: "functional" | "performance";
  setRunType: (type: "functional" | "performance") => void;
  virtualUsers: number;
  setVirtualUsers: (count: number) => void;
  iterationsCount: number;
  setIterationsCount: (count: number) => void;
  stopOnFailure: boolean;
  setStopOnFailure: (value: boolean) => void;
  delayMs: number;
  setDelayMs: (ms: number) => void;
  persistResponses: boolean;
  setPersistResponses: (value: boolean) => void;
  saveCookies: boolean;
  setSaveCookies: (value: boolean) => void;
  extractions: VariableExtractionRule[];
  setExtractions: Dispatch<SetStateAction<VariableExtractionRule[]>>;
  datasetText: string;
  setDatasetText: (text: string) => void;
  datasetRows: Record<string, string>[];
  setDatasetRows: (rows: Record<string, string>[]) => void;
  datasetError: string | null;
  setDatasetError: (error: string | null) => void;
  datasetFileName: string | null;
  setDatasetFileName: (name: string | null) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  isRunning: boolean;
  onRun: () => void;
  canRun: boolean;
  selectedCount: number;
  report?: {
    performanceReport?: {
      throughputRps: number;
      avgLatencyMs: number;
      minLatencyMs: number;
      maxLatencyMs: number;
      errorRatePercent: number;
      virtualUsers: number;
    };
  };
}

export function RunConfigPanel({
  runType,
  setRunType,
  virtualUsers,
  setVirtualUsers,
  iterationsCount,
  setIterationsCount,
  stopOnFailure,
  setStopOnFailure,
  delayMs,
  setDelayMs,
  persistResponses,
  setPersistResponses,
  saveCookies,
  setSaveCookies,
  extractions,
  setExtractions,
  setDatasetText,
  datasetRows,
  setDatasetRows,
  datasetError,
  setDatasetError,
  setDatasetFileName,
  fileInputRef,
  isRunning,
  onRun,
  canRun,
  selectedCount,
  report,
}: RunConfigPanelProps) {
  const { t } = useTranslation();

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
    [setDatasetText, setDatasetRows, setDatasetError, setDatasetFileName, t],
  );

  const handleClearDataset = useCallback(() => {
    setDatasetText("");
    setDatasetRows([]);
    setDatasetError(null);
    setDatasetFileName(null);
  }, [setDatasetText, setDatasetRows, setDatasetError, setDatasetFileName]);

  const addExtractionRule = useCallback(() => {
    setExtractions((prev) => [
      ...prev,
      { id: `ext-${Date.now()}`, source: "jsonPath", path: "", variableName: "" },
    ]);
  }, [setExtractions]);

  const removeExtractionRule = useCallback(
    (id: string) => {
      setExtractions((prev) => prev.filter((r) => r.id !== id));
    },
    [setExtractions],
  );

  const updateExtractionRule = useCallback(
    (id: string, patch: Partial<VariableExtractionRule>) => {
      setExtractions((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    },
    [setExtractions],
  );

  return (
    <div className="space-y-4">
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
                <span className="font-mono font-bold text-foreground">{virtualUsers} VUs</span>
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
              <Label className="text-xs font-medium text-foreground mb-1 block">Iterations</Label>
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
              {datasetError && <p className="text-xs text-destructive mt-1">{datasetError}</p>}
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
            disabled={isRunning}
          >
            <Plus className="size-3" />
            Extraire
          </Button>
        </CardHeader>
        <CardContent className="px-4 pb-3 space-y-2 text-xs">
          {extractions.length === 0 ? (
            <p className="text-[11px] text-muted-foreground italic">
              Aucune règle d'extraction. Ex: extraction automatique de token depuis la réponse.
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
                    updateExtractionRule(rule.id, { source: v as VariableExtractionRule["source"] })
                  }
                  disabled={isRunning}
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
                  disabled={isRunning}
                />

                <span className="text-[11px] font-bold text-muted-foreground">→</span>

                <Input
                  placeholder="authToken"
                  value={rule.variableName}
                  onChange={(e) => updateExtractionRule(rule.id, { variableName: e.target.value })}
                  className="w-28 h-7 text-[11px] font-mono"
                  disabled={isRunning}
                />

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeExtractionRule(rule.id)}
                  className="size-7 text-destructive hover:bg-destructive/10"
                  disabled={isRunning}
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
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={persistResponses}
              onChange={(e) => setPersistResponses(e.target.checked)}
              disabled={isRunning}
              className="rounded border-border text-primary"
            />
            <span>Persist responses for a session</span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={stopOnFailure}
              onChange={(e) => setStopOnFailure(e.target.checked)}
              disabled={isRunning}
              className="rounded border-border text-primary"
            />
            <span>Stop run if an error occurs</span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={saveCookies}
              onChange={(e) => setSaveCookies(e.target.checked)}
              disabled={isRunning}
              className="rounded border-border text-primary"
            />
            <span>Save cookies after collection run</span>
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

      {/* Performance Dashboard Preview (if available) */}
      {report?.performanceReport && (
        <Card className="bg-blue-500/5 border-blue-500/30">
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider flex items-center gap-2">
              <BarChart3 className="size-4" />
              Performance Preview ({report.performanceReport.virtualUsers} VUs)
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              <div className="p-3 bg-card rounded-lg border">
                <span className="text-[11px] text-muted-foreground block">Throughput</span>
                <span className="text-xl font-bold font-mono text-blue-600 dark:text-blue-400">
                  {report.performanceReport.throughputRps} <span className="text-xs">req/s</span>
                </span>
              </div>
              <div className="p-3 bg-card rounded-lg border">
                <span className="text-[11px] text-muted-foreground block">Avg Latency</span>
                <span className="text-xl font-bold font-mono text-foreground">
                  {report.performanceReport.avgLatencyMs} <span className="text-xs">ms</span>
                </span>
              </div>
              <div className="p-3 bg-card rounded-lg border">
                <span className="text-[11px] text-muted-foreground block">Min / Max</span>
                <span className="text-sm font-bold font-mono text-foreground mt-1 block">
                  {report.performanceReport.minLatencyMs} / {report.performanceReport.maxLatencyMs}{" "}
                  ms
                </span>
              </div>
              <div className="p-3 bg-card rounded-lg border">
                <span className="text-[11px] text-muted-foreground block">Error Rate</span>
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

      {/* Big Prominent Start Run Action Button */}
      <Button
        onClick={onRun}
        disabled={!canRun}
        className="w-full h-12 text-base font-bold gap-2 shadow-md bg-orange-600 hover:bg-orange-500 text-white rounded-lg transition-all"
      >
        <ListChecks className="size-5 fill-current" />
        Start run ({selectedCount} request{selectedCount > 1 ? "s" : ""})
      </Button>
    </div>
  );
}

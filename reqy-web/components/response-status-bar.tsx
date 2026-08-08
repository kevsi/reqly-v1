"use client";

import { memo, useState, useEffect } from "react";
import {
  CheckCircle,
  FileText,
  Download,
  Play,
  Loader2,
  XCircle,
  AlertTriangle,
  ChevronDown,
  GitCompare,
} from "lucide-react";
import { getStatusBadgeClass, getStatusTextClass } from "@/lib/http-status-colors";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ResponseStatusBarProps {
  responseStatus?: number;
  responseTime?: number;
  responseSize?: string;
  isLoading?: boolean;
  hasResponse: boolean;
  aiIsLoading?: boolean;
  onRun?: () => Promise<void>;
  onRunAndSave?: () => Promise<void>;
  onRunAndDownload?: () => Promise<void>;
  onAnalyze?: () => Promise<void>;
  onGenerateTests?: () => Promise<void>;
  onExport?: () => void;
  onDiff?: () => void;
}

export const ResponseStatusBar = memo(function ResponseStatusBar({
  responseStatus,
  responseTime,
  responseSize,
  isLoading = false,
  hasResponse,
  onRunAndSave,
  onRunAndDownload,
  onExport,
  onDiff,
}: ResponseStatusBarProps) {
  // ── Animated gauge fill ────────────────────────────────────────
  const targetGaugeWidth = Math.min((responseTime ?? 0) / 10, 100);
  const [gaugeFillWidth, setGaugeFillWidth] = useState(0);

  useEffect(() => {
    let resetTimer: number | undefined;
    let fillTimer: number | undefined;

    if (hasResponse && responseTime !== undefined) {
      resetTimer = window.setTimeout(() => setGaugeFillWidth(0), 0);
      fillTimer = window.setTimeout(() => {
        setGaugeFillWidth(targetGaugeWidth);
      }, 20);
    } else {
      resetTimer = window.setTimeout(() => setGaugeFillWidth(0), 0);
    }

    return () => {
      if (resetTimer) clearTimeout(resetTimer);
      if (fillTimer) clearTimeout(fillTimer);
    };
  }, [responseTime, hasResponse, targetGaugeWidth]);

  const getGaugeFillColor = (time?: number) => {
    if (time === undefined || time === null) return "#6b7280";
    if (time < 300) return "#10b981";
    if (time < 3000) return "#f59e0b";
    return "#ef4444";
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
        {isLoading ? (
          <div className="flex items-center gap-2 rounded-lg border border-warning/20 bg-warning/5 px-3 py-1.5">
            <Loader2 className="size-3.5 animate-spin text-warning" />
            <span className="text-xs font-semibold text-warning">Sending request...</span>
          </div>
        ) : hasResponse ? (
          <div className="flex items-center gap-3">
            {/* Status badge — pill style */}
            <div
              data-testid="response-status"
              className={cn(
                "flex items-center gap-1.5 rounded-lg border px-2.5 py-1",
                getStatusBadgeClass(responseStatus),
              )}
            >
              {responseStatus != null && responseStatus >= 200 && responseStatus < 300 ? (
                <CheckCircle className={cn("size-3.5", getStatusTextClass(responseStatus))} />
              ) : responseStatus != null && responseStatus >= 300 && responseStatus < 400 ? (
                <AlertTriangle className={cn("size-3.5", getStatusTextClass(responseStatus))} />
              ) : responseStatus != null && responseStatus >= 400 ? (
                <XCircle className={cn("size-3.5", getStatusTextClass(responseStatus))} />
              ) : null}
              <span className="text-xs font-bold font-mono tabular-nums">
                {responseStatus ?? "-"}
              </span>
            </div>

            {/* Time — with animated gauge bar */}
            <div className="flex items-center gap-2">
              <div className="h-1.5 rounded-full bg-muted-foreground/10 overflow-hidden w-16">
                <div
                  className="h-full rounded-full transition-all duration-500 ease-out"
                  style={{
                    width: `${gaugeFillWidth}%`,
                    backgroundColor: getGaugeFillColor(responseTime),
                  }}
                />
              </div>
              <span className="text-[11px] font-mono font-semibold text-muted-foreground whitespace-nowrap tabular-nums">
                {responseTime ?? 0}
                <span className="text-muted-foreground/70">ms</span>
              </span>
            </div>

            {/* Size — compact */}
            <div className="flex items-center gap-1 rounded-md border border-muted-foreground/10 bg-muted/20 px-2 py-1">
              <FileText className="size-3 text-muted-foreground/70" />
              <span className="text-[11px] font-mono font-semibold text-muted-foreground tabular-nums">
                {responseSize ?? "0 B"}
              </span>
            </div>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground/70 italic">Awaiting request...</span>
        )}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              disabled={isLoading}
              size="sm"
              className={cn(
                "h-8 gap-1.5 text-xs font-semibold transition-all duration-200",
                isLoading && "opacity-80",
              )}
            >
              {isLoading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Play className="size-3.5 fill-current" />
              )}
              {isLoading ? "Running..." : "Send"}
              <ChevronDown className="size-3 text-muted-foreground/60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem
              onSelect={onRunAndSave}
              disabled={isLoading || !onRunAndSave}
              className="cursor-pointer text-xs gap-2"
            >
              <Play className="size-3.5" />
              Send & Save
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={onRunAndDownload}
              disabled={isLoading || !onRunAndDownload}
              className="cursor-pointer text-xs gap-2"
            >
              <Download className="size-3.5" />
              Send & Download
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs font-medium transition-all duration-200"
          onClick={onExport}
          disabled={!hasResponse}
        >
          <Download className="size-3.5" />
          Export
        </Button>
        {onDiff && (
          <Button
            variant="outline"
            size="sm"
            onClick={onDiff}
            disabled={!hasResponse}
            className="h-8 gap-1.5 text-xs font-medium transition-all duration-200"
          >
            <GitCompare className="size-3.5" />
            Diff
          </Button>
        )}
      </div>
    </div>
  );
});

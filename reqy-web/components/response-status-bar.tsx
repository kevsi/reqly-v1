"use client";

import { memo } from "react";
import {
  CheckCircle,
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
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
        {isLoading ? (
          <div className="flex items-center gap-2 rounded-lg border border-warning/20 bg-warning/5 px-3 py-1.5">
            <Loader2 className="size-3.5 animate-spin text-warning" />
            <span className="text-xs font-semibold text-warning">{t("response.sending")}</span>
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

            {/* Time */}
            <span className="text-xs font-mono font-semibold text-muted-foreground whitespace-nowrap tabular-nums">
              {responseTime ?? 0}
              <span className="text-muted-foreground/70">ms</span>
            </span>

            {/* Size */}
            <span className="text-xs font-mono text-muted-foreground tabular-nums">
              {responseSize ?? "0 B"}
            </span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground/70 italic">{t("response.awaiting")}</span>
        )}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              disabled={isLoading}
              size="sm"
              className={cn(
                "h-8 gap-1.5 text-xs font-semibold transition-colors",
                isLoading && "opacity-80",
              )}
            >
              {isLoading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Play className="size-3.5 fill-current" />
              )}
              {isLoading ? t("response.running") : t("response.send")}
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
              {t("response.sendAndSave")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={onRunAndDownload}
              disabled={isLoading || !onRunAndDownload}
              className="cursor-pointer text-xs gap-2"
            >
              <Download className="size-3.5" />
              {t("response.sendAndDownload")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs font-medium transition-colors"
          onClick={onExport}
          disabled={!hasResponse}
        >
          <Download className="size-3.5" />
          {t("response.export")}
        </Button>
        {onDiff && (
          <Button
            variant="outline"
            size="sm"
            onClick={onDiff}
            disabled={!hasResponse}
            className="h-8 gap-1.5 text-xs font-medium transition-colors"
          >
            <GitCompare className="size-3.5" />
            {t("response.diff")}
          </Button>
        )}
      </div>
    </div>
  );
});

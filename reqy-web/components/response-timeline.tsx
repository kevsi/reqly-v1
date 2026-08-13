"use client";

import { memo } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";

export interface ResponseTimings {
  dnsMs?: number;
  connectMs?: number;
  ttfbMs?: number;
  totalMs: number;
}

interface ResponseTimelineProps {
  timings: ResponseTimings;
}

const COLORS = {
  dns: "bg-blue-500/70",
  connect: "bg-violet-500/70",
  ttfb: "bg-orange-500/70",
  transfer: "bg-success/70",
};

export const ResponseTimeline = memo(function ResponseTimeline({ timings }: ResponseTimelineProps) {
  const { t } = useTranslation();
  const { dnsMs = 0, connectMs = 0, ttfbMs = 0, totalMs } = timings;

  const LABELS = {
    dns: t("response.timelineDns"),
    connect: t("response.timelineConnect"),
    ttfb: t("response.timelineTtfb"),
    transfer: t("response.timelineTransfer"),
  };

  // Transfer is what remains after DNS, Connect, and TTFB
  // Note: TTFB includes connection time + waiting for first byte
  // We approximate transfer as: total - ttfb (since ttfb includes connect + wait)
  const transferMs = Math.max(0, totalMs - ttfbMs);
  const waitMs = Math.max(0, ttfbMs - connectMs);

  // Build segments with actual timings
  const segments: { key: string; ms: number; color: string; label: string }[] = [];

  if (dnsMs > 0) {
    segments.push({ key: "dns", ms: dnsMs, color: COLORS.dns, label: LABELS.dns });
  }
  if (connectMs > 0) {
    segments.push({ key: "connect", ms: connectMs, color: COLORS.connect, label: LABELS.connect });
  }
  if (waitMs > 0) {
    segments.push({ key: "ttfb", ms: waitMs, color: COLORS.ttfb, label: LABELS.ttfb });
  }
  if (transferMs > 0) {
    segments.push({
      key: "transfer",
      ms: transferMs,
      color: COLORS.transfer,
      label: LABELS.transfer,
    });
  }

  // Find if any segment takes >50% of total
  const dominantSegment = segments.find((s) => totalMs > 0 && s.ms / totalMs > 0.5);

  // If no segments, nothing to show
  if (segments.length === 0 || totalMs === 0) {
    return null;
  }

  return (
    <div className="px-4 py-2 border-b border-border/50 bg-muted/10">
      <div className="flex items-center gap-3">
        {/* Segmented bar */}
        <div className="flex-1 h-2 rounded-full bg-muted-foreground/10 overflow-hidden flex">
          {segments.map((segment) => (
            <div
              key={segment.key}
              className={cn("h-full transition-all duration-300", segment.color)}
              style={{ width: `${(segment.ms / totalMs) * 100}%` }}
            />
          ))}
        </div>

        {/* Labels and durations */}
        <div className="flex items-center gap-2 flex-wrap">
          {segments.map((segment) => (
            <div
              key={segment.key}
              className={cn(
                "flex items-center gap-1 text-[10px] font-mono",
                dominantSegment?.key === segment.key ? "text-warning" : "text-muted-foreground",
              )}
            >
              <span
                className={cn(dominantSegment?.key === segment.key && "flex items-center gap-0.5")}
              >
                {dominantSegment?.key === segment.key && <AlertTriangle className="size-2.5" />}
                {segment.label}
              </span>
              <span className="tabular-nums">{segment.ms}</span>
              <span className="text-muted-foreground/70">ms</span>
            </div>
          ))}

          {/* Separator */}
          <div className="text-muted-foreground/30">·</div>

          {/* Total */}
          <div className="flex items-center gap-1 text-[10px] font-mono text-foreground/70">
            <span>{t("response.timelineTotal")}</span>
            <span className="tabular-nums">{totalMs}</span>
            <span className="text-muted-foreground/70">ms</span>
          </div>
        </div>
      </div>
    </div>
  );
});

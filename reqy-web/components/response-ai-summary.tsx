"use client";

import { memo } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Text } from "@/components/ui/text";

interface ResponseAiSummaryProps {
  aiSummary?: string;
  aiError?: string;
  aiIsLoading?: boolean;
}

export const ResponseAiSummary = memo(function ResponseAiSummary({
  aiSummary,
  aiError,
  aiIsLoading = false,
}: ResponseAiSummaryProps) {
  if (!aiSummary && !aiError && !aiIsLoading) return null;

  return (
    <div
      className={cn(
        "border-b border-border px-4 py-3 transition-colors duration-300 animate-slide-up",
        aiIsLoading && "bg-primary/[0.02]",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-full",
            aiIsLoading ? "bg-primary/10" : aiError ? "bg-destructive/10" : "bg-primary/10",
          )}
        >
          <Sparkles
            className={cn(
              "size-4",
              aiIsLoading
                ? "text-primary animate-pulse"
                : aiError
                  ? "text-destructive"
                  : "text-primary",
            )}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Text variant="label" className="text-muted-foreground/70">
              AI Summary
            </Text>
            {aiIsLoading && (
              <span className="flex items-center gap-1 text-[10px] text-primary">
                <span className="size-1.5 rounded-full bg-primary animate-pulse" />
                Analyzing...
              </span>
            )}
          </div>
          {aiIsLoading ? (
            <div className="space-y-1.5">
              <div className="shimmer h-3 w-full rounded" />
              <div className="shimmer h-3 w-3/4 rounded" />
            </div>
          ) : aiError ? (
            <div className="rounded-lg border border-destructive/10 bg-destructive/5 px-3 py-2">
              <p className="text-xs text-destructive/90">{aiError}</p>
            </div>
          ) : (
            <div className="rounded-lg border border-primary/10 bg-primary/[0.02] px-3 py-2">
              <p className="text-xs text-muted-foreground/90 leading-relaxed">{aiSummary}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

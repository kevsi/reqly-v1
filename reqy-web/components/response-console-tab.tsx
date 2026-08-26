"use client";

import { memo, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { ConsoleEntry } from "@/lib/test-runner/scripts";

interface ConsoleTabProps {
  entries: ConsoleEntry[];
}

const LEVEL_STYLES = {
  log: "text-foreground",
  warn: "text-amber-500",
  error: "text-destructive",
} as const;

const LEVEL_PREFIX = {
  log: "",
  warn: "⚠ ",
  error: "✕ ",
} as const;

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour12: false }) + "." + String(d.getMilliseconds()).padStart(3, "0");
}

export const ConsoleTab = memo(function ConsoleTab({ entries }: ConsoleTabProps) {
  const { t } = useTranslation();
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll au dernier message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length]);

  if (entries.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-xs text-muted-foreground italic">
          {t("response.consoleEmpty", "Aucun log — les scripts peuvent utiliser console.log()")}
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-muted/5">
      <div className="font-mono text-xs">
        {entries.map((e, i) => (
          <div
            key={i}
            className={cn(
              "flex items-start gap-2 border-b border-border/30 px-4 py-1",
              LEVEL_STYLES[e.level],
            )}
          >
            <span className="shrink-0 text-muted-foreground/50 tabular-nums">
              {formatTime(e.timestamp)}
            </span>
            <span className="shrink-0 w-3">{LEVEL_PREFIX[e.level]}</span>
            <span className="whitespace-pre-wrap break-all">{e.message}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
});

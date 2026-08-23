"use client";

import { useMemo } from "react";
import { getStatusBadgeClass } from "@/lib/http-status-colors";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Copy, Check } from "lucide-react";

export interface DiffLine {
  type: "added" | "removed" | "unchanged";
  content: string;
}

export interface DiffResult {
  lines: DiffLine[];
  leftLines: number;
  rightLines: number;
  addedLines: number;
  removedLines: number;
}

/**
 * Hard cap on the size of the trimmed "middle" (after common prefix/suffix
 * removal) fed to the O(n×m) LCS matrix. Beyond this, the full-matrix
 * allocation can freeze/crash the tab, so we collapse the middle instead.
 */
export const MAX_DIFF_LINES = 2000;

/**
 * Simple LCS-based line diff algorithm.
 *
 * PERF-1: common prefix/suffix lines are trimmed before the (m+1)×(n+1)
 * matrix is allocated, so typical diffs (small change inside a big payload)
 * only pay for the changed region. If the trimmed middle still exceeds
 * MAX_DIFF_LINES per side, LCS is skipped entirely and the middle collapses
 * into one removed-block / added-block pair annotated with the omitted count.
 */
export function computeLineDiff(leftRaw: string, rightRaw: string): DiffResult {
  const leftLines = leftRaw.split("\n");
  const rightLines = rightRaw.split("\n");

  // ── Trim common prefix ────────────────────────────────────────────────
  let prefixLen = 0;
  while (
    prefixLen < leftLines.length &&
    prefixLen < rightLines.length &&
    leftLines[prefixLen] === rightLines[prefixLen]
  ) {
    prefixLen++;
  }

  // ── Trim common suffix (never overlapping the prefix) ────────────────
  let suffixLen = 0;
  while (
    suffixLen < leftLines.length - prefixLen &&
    suffixLen < rightLines.length - prefixLen &&
    leftLines[leftLines.length - 1 - suffixLen] === rightLines[rightLines.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const prefix: DiffLine[] = [];
  for (let k = 0; k < prefixLen; k++) {
    prefix.push({ type: "unchanged", content: leftLines[k] });
  }
  const suffix: DiffLine[] = [];
  for (let k = leftLines.length - suffixLen; k < leftLines.length; k++) {
    suffix.push({ type: "unchanged", content: leftLines[k] });
  }

  const midLeft = leftLines.slice(prefixLen, leftLines.length - suffixLen);
  const midRight = rightLines.slice(prefixLen, rightLines.length - suffixLen);

  let middle: DiffLine[];
  if (midLeft.length > MAX_DIFF_LINES || midRight.length > MAX_DIFF_LINES) {
    // ── Cap path: skip LCS, collapse the middle with omitted-line counts ──
    middle = [];
    if (midLeft.length > 0) {
      middle.push({ type: "removed", content: `… ${midLeft.length} lignes omises …` });
    }
    if (midRight.length > 0) {
      middle.push({ type: "added", content: `… ${midRight.length} lignes omises …` });
    }
  } else {
    middle = lcsMiddleDiff(midLeft, midRight);
  }

  const diffLines = [...prefix, ...middle, ...suffix];

  const addedLines = diffLines.filter((l) => l.type === "added").length;
  const removedLines = diffLines.filter((l) => l.type === "removed").length;

  return {
    lines: diffLines,
    leftLines: leftLines.length,
    rightLines: rightLines.length,
    addedLines,
    removedLines,
  };
}

/** LCS backtrack over the already-trimmed middle sections only. */
function lcsMiddleDiff(midLeft: string[], midRight: string[]): DiffLine[] {
  const m = midLeft.length;
  const n = midRight.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (midLeft[i - 1] === midRight[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const tempLines: DiffLine[] = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && midLeft[i - 1] === midRight[j - 1]) {
      tempLines.push({ type: "unchanged", content: midLeft[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      tempLines.push({ type: "added", content: midRight[j - 1] });
      j--;
    } else {
      tempLines.push({ type: "removed", content: midLeft[i - 1] });
      i--;
    }
  }

  const diffLines: DiffLine[] = [];
  for (let k = tempLines.length - 1; k >= 0; k--) {
    diffLines.push(tempLines[k]);
  }
  return diffLines;
}

function tryFormatJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function isValidJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

interface DiffViewerProps {
  left: string;
  right: string;
  leftLabel?: string;
  rightLabel?: string;
  leftStatus?: number;
  rightStatus?: number;
  className?: string;
  viewMode?: "unified" | "split";
  onCopyLeft?: () => void;
  onCopyRight?: () => void;
  copiedLeft?: boolean;
  copiedRight?: boolean;
}

export function DiffViewer({
  left,
  right,
  leftLabel = "Left",
  rightLabel = "Right",
  leftStatus,
  rightStatus,
  className,
  viewMode = "unified",
  onCopyLeft,
  onCopyRight,
  copiedLeft,
  copiedRight,
}: DiffViewerProps) {
  const { diff } = useMemo(() => {
    const leftFmt = isValidJson(left) ? tryFormatJson(left) : left;
    const rightFmt = isValidJson(right) ? tryFormatJson(right) : right;
    return {
      diff: computeLineDiff(leftFmt, rightFmt),
      leftFormatted: leftFmt,
      rightFormatted: rightFmt,
    };
  }, [left, right]);

  const changedPercent =
    diff.lines.length > 0
      ? Math.round(((diff.addedLines + diff.removedLines) / diff.lines.length) * 100)
      : 0;

  return (
    <div className={cn("flex flex-col h-full bg-background", className)}>
      {/* ── Stats bar ─────────────────────────────────────────── */}
      <div className="flex items-center gap-6 px-4 py-2.5 border-b border-border bg-muted/20 text-xs shrink-0">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-success" />
            <span className="font-semibold text-success">+{diff.addedLines}</span>
            <span className="text-muted-foreground">added</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-destructive" />
            <span className="font-semibold text-destructive">-{diff.removedLines}</span>
            <span className="text-muted-foreground">removed</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-muted-foreground/40" />
            <span className="text-muted-foreground">
              {diff.lines.length - diff.addedLines - diff.removedLines} unchanged
            </span>
          </span>
        </div>

        {/* Change bar */}
        <div className="flex-1 max-w-[200px] h-1.5 rounded-full bg-muted overflow-hidden">
          <div className="flex h-full">
            <div
              className="bg-destructive/70 h-full transition-all"
              style={{
                width: `${Math.round((diff.removedLines / Math.max(diff.lines.length, 1)) * 100)}%`,
              }}
            />
            <div
              className="bg-success/70 h-full transition-all"
              style={{
                width: `${Math.round((diff.addedLines / Math.max(diff.lines.length, 1)) * 100)}%`,
              }}
            />
          </div>
        </div>

        <span className="ml-auto text-muted-foreground/60">
          {changedPercent}% changed · {diff.lines.length} total lines
        </span>
      </div>

      {viewMode === "split" ? (
        /* ── SPLIT VIEW ─────────────────────────────────────── */
        <div className="flex flex-1 min-h-0 divide-x divide-border">
          {/* Left panel */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="flex items-center justify-between gap-2 px-4 py-2 bg-destructive/5 border-b border-destructive/20 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="flex size-5 items-center justify-center rounded-full bg-destructive/15 text-[10px] font-bold text-destructive">
                  L
                </span>
                {leftStatus != null && (
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-bold",
                      getStatusBadgeClass(leftStatus),
                    )}
                  >
                    {leftStatus}
                  </span>
                )}
                <span className="text-xs font-medium text-muted-foreground truncate">
                  {leftLabel}
                </span>
              </div>
              {onCopyLeft && (
                <button
                  onClick={onCopyLeft}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
                >
                  {copiedLeft ? (
                    <Check className="size-3 text-destructive" />
                  ) : (
                    <Copy className="size-3" />
                  )}
                  {copiedLeft ? "Copied" : "Copy"}
                </button>
              )}
            </div>
            <ScrollArea className="flex-1">
              <div className="font-mono text-xs leading-5">
                {diff.lines.map(
                  (line, idx) =>
                    line.type !== "added" && (
                      <div
                        key={idx}
                        className={cn(
                          "flex min-h-[20px] px-4 group",
                          line.type === "removed" && "bg-destructive/8 hover:bg-destructive/12",
                          line.type === "unchanged" && "hover:bg-muted/30",
                        )}
                      >
                        <span
                          className={cn(
                            "shrink-0 w-5 select-none text-right pr-3 font-mono text-[10px] leading-5",
                            line.type === "removed"
                              ? "text-destructive"
                              : "text-muted-foreground/30",
                          )}
                        >
                          {line.type === "removed" ? "−" : " "}
                        </span>
                        <pre
                          className={cn(
                            "whitespace-pre-wrap break-all flex-1 py-0",
                            line.type === "removed" ? "text-destructive" : "text-muted-foreground",
                          )}
                        >
                          {line.content || " "}
                        </pre>
                      </div>
                    ),
                )}
              </div>
            </ScrollArea>
          </div>

          {/* Right panel */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="flex items-center justify-between gap-2 px-4 py-2 bg-success/5 border-b border-success/20 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="flex size-5 items-center justify-center rounded-full bg-success/15 text-[10px] font-bold text-success">
                  R
                </span>
                {rightStatus != null && (
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-bold",
                      getStatusBadgeClass(rightStatus),
                    )}
                  >
                    {rightStatus}
                  </span>
                )}
                <span className="text-xs font-medium text-muted-foreground truncate">
                  {rightLabel}
                </span>
              </div>
              {onCopyRight && (
                <button
                  onClick={onCopyRight}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
                >
                  {copiedRight ? (
                    <Check className="size-3 text-success" />
                  ) : (
                    <Copy className="size-3" />
                  )}
                  {copiedRight ? "Copied" : "Copy"}
                </button>
              )}
            </div>
            <ScrollArea className="flex-1">
              <div className="font-mono text-xs leading-5">
                {diff.lines.map(
                  (line, idx) =>
                    line.type !== "removed" && (
                      <div
                        key={idx}
                        className={cn(
                          "flex min-h-[20px] px-4 group",
                          line.type === "added" && "bg-success/8 hover:bg-success/12",
                          line.type === "unchanged" && "hover:bg-muted/30",
                        )}
                      >
                        <span
                          className={cn(
                            "shrink-0 w-5 select-none text-right pr-3 font-mono text-[10px] leading-5",
                            line.type === "added" ? "text-success" : "text-muted-foreground/30",
                          )}
                        >
                          {line.type === "added" ? "+" : " "}
                        </span>
                        <pre
                          className={cn(
                            "whitespace-pre-wrap break-all flex-1 py-0",
                            line.type === "added" ? "text-success" : "text-muted-foreground",
                          )}
                        >
                          {line.content || " "}
                        </pre>
                      </div>
                    ),
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      ) : (
        /* ── UNIFIED VIEW ───────────────────────────────────── */
        <>
          {/* Column headers */}
          <div className="flex items-center gap-0 border-b border-border shrink-0 text-xs">
            <div className="flex flex-1 items-center justify-between gap-2 px-4 py-2 bg-destructive/5 border-r border-border">
              <div className="flex items-center gap-2">
                <span className="flex size-5 items-center justify-center rounded-full bg-destructive/15 text-[10px] font-bold text-destructive">
                  L
                </span>
                {leftStatus && (
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-bold",
                      getStatusBadgeClass(leftStatus),
                    )}
                  >
                    {leftStatus}
                  </span>
                )}
                <span className="font-medium text-muted-foreground truncate">{leftLabel}</span>
              </div>
              {onCopyLeft && (
                <button
                  onClick={onCopyLeft}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
                >
                  {copiedLeft ? (
                    <Check className="size-3 text-destructive" />
                  ) : (
                    <Copy className="size-3" />
                  )}
                  {copiedLeft ? "Copied" : "Copy"}
                </button>
              )}
            </div>
            <div className="flex flex-1 items-center justify-between gap-2 px-4 py-2 bg-success/5">
              <div className="flex items-center gap-2">
                <span className="flex size-5 items-center justify-center rounded-full bg-success/15 text-[10px] font-bold text-success">
                  R
                </span>
                {rightStatus && (
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-bold",
                      getStatusBadgeClass(rightStatus),
                    )}
                  >
                    {rightStatus}
                  </span>
                )}
                <span className="font-medium text-muted-foreground truncate">{rightLabel}</span>
              </div>
              {onCopyRight && (
                <button
                  onClick={onCopyRight}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
                >
                  {copiedRight ? (
                    <Check className="size-3 text-success" />
                  ) : (
                    <Copy className="size-3" />
                  )}
                  {copiedRight ? "Copied" : "Copy"}
                </button>
              )}
            </div>
          </div>

          <ScrollArea className="flex-1">
            <div className="font-mono text-xs leading-5">
              {diff.lines.map((line, idx) => (
                <div
                  key={idx}
                  className={cn(
                    "flex min-h-[20px] px-4 border-l-2 transition-colors group",
                    line.type === "added" && "bg-success/8 border-success hover:bg-success/12",
                    line.type === "removed" &&
                      "bg-destructive/8 border-destructive hover:bg-destructive/12",
                    line.type === "unchanged" && "border-transparent hover:bg-muted/30",
                  )}
                >
                  <span
                    className={cn(
                      "shrink-0 w-5 select-none font-mono text-[11px] leading-5 font-bold mr-2",
                      line.type === "added" && "text-success",
                      line.type === "removed" && "text-destructive",
                      line.type === "unchanged" && "text-muted-foreground/25",
                    )}
                  >
                    {line.type === "added" ? "+" : line.type === "removed" ? "−" : " "}
                  </span>
                  <pre
                    className={cn(
                      "whitespace-pre-wrap break-all flex-1 py-0",
                      line.type === "added" && "text-success",
                      line.type === "removed" && "text-destructive",
                      line.type === "unchanged" && "text-muted-foreground/70",
                    )}
                  >
                    {line.content || " "}
                  </pre>
                </div>
              ))}
            </div>
          </ScrollArea>
        </>
      )}
    </div>
  );
}

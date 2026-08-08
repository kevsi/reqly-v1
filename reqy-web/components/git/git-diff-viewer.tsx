"use client";

import { FileText } from "lucide-react";
import { cn } from "@/lib/utils";

import type { DiffFile } from "@/hooks/use-git";

interface DiffViewerProps {
  files: DiffFile[];
  loading?: boolean;
}

export function GitDiffViewer({ files, loading }: DiffViewerProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <span className="ml-2 text-xs text-muted-foreground">Computing diff…</span>
      </div>
    );
  }

  if (files.length === 0) {
    return <p className="text-xs text-muted-foreground py-4 text-center">No differences found.</p>;
  }

  return (
    <div className="space-y-3">
      {files.map((file) => (
        <div key={file.filepath} className="rounded-lg border border-border/60 overflow-hidden">
          <div className="flex items-center gap-2 bg-muted/30 px-3 py-1.5 text-xs font-medium text-foreground/80 border-b border-border/40">
            <FileText className="size-3.5 text-muted-foreground" />
            {file.filepath}
            <span className="text-[10px] text-muted-foreground/40 ml-auto">
              {file.hunks.reduce((acc, h) => acc + h.lines.length, 0)} lines
            </span>
          </div>
          <div className="bg-background">
            {file.hunks.map((hunk, hi) => (
              <div key={hi}>
                {/* Hunk header */}
                <div className="px-3 py-1 text-[10px] font-mono text-muted-foreground/40 bg-muted/10 border-b border-border/20">
                  @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
                </div>
                {/* Hunk lines */}
                {hunk.lines.slice(0, 500).map((line, li) => (
                  <div
                    key={li}
                    className={cn(
                      "flex text-[11px] font-mono leading-5",
                      line.origin === "add" && "bg-success/5",
                      line.origin === "delete" && "bg-destructive/5",
                    )}
                  >
                    <span className="w-8 text-right text-[10px] text-muted-foreground/30 select-none shrink-0 px-1">
                      {line.oldLineno ?? ""}
                    </span>
                    <span className="w-8 text-right text-[10px] text-muted-foreground/30 select-none shrink-0 px-1 border-r border-border/20">
                      {line.newLineno ?? ""}
                    </span>
                    <span
                      className={cn(
                        "w-4 text-center shrink-0 select-none",
                        line.origin === "add" && "text-success",
                        line.origin === "delete" && "text-destructive",
                        line.origin === "context" && "text-muted-foreground/40",
                      )}
                    >
                      {line.origin === "add" ? "+" : line.origin === "delete" ? "-" : " "}
                    </span>
                    <span className="flex-1 px-1 whitespace-pre">{line.content}</span>
                  </div>
                ))}
                {hunk.lines.length > 500 && (
                  <p className="text-[10px] text-muted-foreground/40 px-3 py-1">
                    … {hunk.lines.length - 500} more lines
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

"use client";
import { Sparkles } from "lucide-react";
import type { Diagnostic } from "@/src/ai/types";
import { FixSuggestion } from "./FixSuggestion";

export function Panel({
  diagnostics,
  onApplyFix,
}: {
  diagnostics: Diagnostic[];
  onApplyFix?: (diag: Diagnostic) => void;
}) {
  if (diagnostics.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[200px] gap-3 text-center px-4" data-testid="reqlyai-panel-empty">
        <div className="flex size-12 items-center justify-center rounded-full bg-primary/10">
          <Sparkles className="size-5 text-primary" />
        </div>
        <div>
          <p className="text-sm font-semibold">ReqlyAI</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Aucun diagnostic — envoie une requête pour commencer.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3 p-4" data-testid="reqlyai-panel">
      <div className="flex items-center gap-2 pb-2 border-b border-border">
        <Sparkles className="size-4 text-primary" />
        <span className="text-sm font-semibold">ReqlyAI</span>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {diagnostics.length} diagnostic{diagnostics.length > 1 ? "s" : ""}
        </span>
      </div>
      {diagnostics.map((d) => (
        <FixSuggestion
          key={d.id}
          diagnostic={d}
          onApply={onApplyFix ? () => onApplyFix(d) : undefined}
        />
      ))}
    </div>
  );
}

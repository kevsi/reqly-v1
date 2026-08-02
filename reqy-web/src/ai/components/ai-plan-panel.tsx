"use client";
import { ListChecks, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ToolCall } from "@/lib/llm-tools";
import { maskSensitiveObject } from "@/lib/llm-tools";

interface Props {
  planText: string;
  toolCalls: ToolCall[];
  onApprove: () => void;
  onReject: () => void;
}

export function AiPlanPanel({ planText, toolCalls, onApprove, onReject }: Props) {
  return (
    <div className="rounded-xl border border-primary/40 bg-primary/5 p-3 text-sm" data-testid="ai-plan-panel">
      <div className="flex items-center gap-2 font-medium text-primary mb-2">
        <ListChecks className="size-4" /> Plan proposé
      </div>
      <p className="text-foreground whitespace-pre-wrap leading-relaxed">{planText}</p>
      {toolCalls.length > 0 && (
        <div className="mt-2 space-y-1">
          {toolCalls.map((tc, i) => {
            let safe: Record<string, unknown> = {};
            try {
              safe = JSON.parse(tc.arguments);
            } catch {
              /* ignore */
            }
            return (
              <div
                key={i}
                className="rounded-md bg-background border border-border px-2 py-1 font-mono text-[11px] text-muted-foreground"
              >
                <span className="text-primary">{tc.name}</span>(
                {JSON.stringify(maskSensitiveObject(safe))})
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-3 flex gap-2 justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={onReject} className="h-7 px-2 text-xs">
          <X className="size-3 mr-1" /> Réviser
        </Button>
        <Button
          type="button"
          variant="default"
          size="sm"
          onClick={onApprove}
          className="h-7 px-2 text-xs"
          data-testid="ai-plan-approve"
        >
          <Check className="size-3 mr-1" /> Approuver & exécuter
        </Button>
      </div>
    </div>
  );
}

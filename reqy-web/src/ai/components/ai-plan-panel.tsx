"use client";
import { ListChecks, Check, X, ChevronRight, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { ToolCall } from "@/lib/llm-tools";
import { getToolTitle, maskSensitiveObject } from "@/lib/llm-tools";

interface Props {
  planText: string;
  toolCalls: ToolCall[];
  onApprove: () => void;
  onReject: () => void;
  isLoading?: boolean;
}

export function AiPlanPanel({ planText, toolCalls, onApprove, onReject, isLoading }: Props) {
  const { t } = useTranslation();
  return (
    <div
      className="overflow-hidden rounded-lg border border-primary/30 bg-card"
      data-testid="ai-plan-panel"
    >
      <div className="flex items-center gap-2 border-b border-border/60 bg-muted/30 px-3 py-2.5 font-medium text-primary">
        <span className="flex size-5 items-center justify-center rounded-md bg-primary/15 text-primary ring-1 ring-primary/25">
          <ListChecks className="size-3.5" />
        </span>
        {t("ai.plan.title")}
      </div>

      <div className="space-y-3 p-3">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{planText}</p>

        {toolCalls.length > 0 && (
          <div className="space-y-1.5">
            {toolCalls.map((tc, i) => {
              let safe: Record<string, unknown> = {};
              try {
                safe = JSON.parse(tc.arguments);
              } catch {
                /* ignore */
              }
              const title = getToolTitle(tc.name);
              return (
                <div
                  key={i}
                  className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1.5 transition-colors hover:border-primary/20"
                  title={tc.name}
                >
                  <ChevronRight className="size-3 shrink-0 text-primary/70" />
                  <span className="min-w-0 truncate text-[12px] font-medium text-foreground">
                    {title}
                  </span>
                  {Object.keys(safe).length > 0 && (
                    <code className="min-w-0 truncate font-mono text-[10px] text-muted-foreground">
                      ({JSON.stringify(maskSensitiveObject(safe))})
                    </code>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-1.5 border-t border-border/60 bg-muted/20 px-3 py-2.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onReject}
          className="h-7 gap-1 px-2.5 text-xs text-muted-foreground hover:text-foreground"
          title={t("ai.plan.cancelTitle")}
        >
          <X className="size-3" />
          <span className="@max-[22rem]:hidden">{t("common.cancel")}</span>
        </Button>
        <Button
          type="button"
          variant="default"
          size="sm"
          onClick={onApprove}
          disabled={isLoading}
          className="h-7 gap-1 px-3 text-xs"
          title={t("ai.plan.approve")}
          data-testid="ai-plan-approve"
        >
          {isLoading ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
          <span className="@max-[22rem]:hidden">
            {isLoading ? t("ai.plan.executing") : t("ai.plan.approve")}
          </span>
        </Button>
      </div>
    </div>
  );
}

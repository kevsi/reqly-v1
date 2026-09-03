"use client";

import { Loader2, Play, ShieldCheck, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { ParsedCodeRequest } from "@/src/ai/agent/code-request";

interface AiCodeExecutionCardProps {
  request: ParsedCodeRequest;
  isExecuting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function AiCodeExecutionCard({
  request,
  isExecuting,
  onConfirm,
  onCancel,
}: AiCodeExecutionCardProps) {
  const { t } = useTranslation();
  const headerCount = Object.keys(request.headers).length;

  return (
    <div
      className="mx-3 mb-2 rounded-lg border border-warning/30 bg-warning/5 p-3"
      data-testid="ai-code-execution-card"
    >
      <div className="flex items-start gap-2">
        <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning">
          <ShieldCheck className="size-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-foreground">{t("ai.code.confirmTitle")}</p>
          <p className="mt-1 break-all font-mono text-[11px] text-foreground/85">
            <span className="font-semibold text-primary">{request.method}</span> {request.url}
          </p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {t("ai.code.confirmDetails", {
              headers: headerCount,
              body: request.body ? t("ai.code.bodyIncluded") : t("ai.code.noBody"),
            })}
          </p>
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-1.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={isExecuting}
          className="h-7 px-2.5 text-xs"
        >
          {t("ai.code.cancel")}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={onConfirm}
          disabled={isExecuting}
          className="h-7 gap-1.5 px-2.5 text-xs"
        >
          {isExecuting ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
          {isExecuting ? t("ai.code.executing") : t("ai.code.confirm")}
        </Button>
      </div>
    </div>
  );
}

"use client";
import { useState } from "react";
import { ChevronDown, FileText, ListChecks, Settings2, ShieldCheck, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { AgentMode } from "@/src/ai/agent/types";
import { formatTokens } from "@/src/ai/agent/usage";
import type { AgentUsage } from "@/src/ai/agent/types";

interface Props {
  mode: AgentMode;
  onModeChange: (m: AgentMode) => void;
  autoApply: boolean;
  onAutoApplyChange: (v: boolean) => void;
  onOpenRules: () => void;
  onOpenPermissions: () => void;
  sessionUsage?: AgentUsage;
  /** Modèle utilisé par la génération courante (F8 — traçabilité). */
  model?: string | null;
  /** Confirmer en lot : un Confirmer approuve toute la série en attente. */
  batchConfirm?: boolean;
  onBatchConfirmChange?: (v: boolean) => void;
}

/**
 * Controls the agent without competing with the conversation.
 * The active mode and approval state stay visible; rules and permissions are
 * grouped behind one disclosure so the sidebar reads as a workspace first.
 */
export function AiAgentControls({
  mode,
  onModeChange,
  autoApply,
  onAutoApplyChange,
  onOpenRules,
  onOpenPermissions,
  sessionUsage,
  model,
  batchConfirm = false,
  onBatchConfirmChange,
}: Props) {
  const { t } = useTranslation();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const usageLabel = sessionUsage ? formatTokens(sessionUsage) : null;

  return (
    <div
      className="shrink-0 border-b border-border/40 bg-background/50 backdrop-blur-sm"
      data-testid="ai-agent-controls"
    >
      <div className="flex h-10 items-center gap-2 px-3">
        <span className="sr-only">{t("ai.agent.mode")}</span>
        <div className="flex shrink-0 items-center rounded-lg bg-muted/50 p-0.5">
          <button
            type="button"
            onClick={() => onModeChange("plan")}
            aria-pressed={mode === "plan"}
            className={cn(
              "flex h-6 items-center gap-1 rounded-md px-2 text-[11px] font-medium transition-colors",
              mode === "plan"
                ? "bg-background text-foreground shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground",
            )}
            title={t("ai.agent.planModeTitle")}
            data-testid="ai-mode-plan"
          >
            <ListChecks className="size-3" />
            <span>{t("ai.agent.plan")}</span>
          </button>
          <button
            type="button"
            onClick={() => onModeChange("act")}
            aria-pressed={mode === "act"}
            className={cn(
              "flex h-6 items-center gap-1 rounded-md px-2 text-[11px] font-medium transition-colors",
              mode === "act"
                ? "bg-primary text-primary-foreground shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground",
            )}
            title={t("ai.agent.actModeTitle")}
            data-testid="ai-mode-act"
          >
            <Zap className="size-3" />
            <span>{t("ai.agent.act")}</span>
          </button>
        </div>

        <span
          className={cn(
            "inline-flex min-w-0 truncate rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors",
            autoApply
              ? "bg-warning/10 text-warning"
              : batchConfirm
                ? "bg-primary/10 text-primary"
                : "bg-muted/40 text-muted-foreground",
          )}
          title={
            autoApply
              ? t("ai.agent.autoApplyOnDesc", { defaultValue: "Auto : les actions non sensibles s'exécutent seules. Les actions sensibles (exécuter, supprimer) demandent toujours confirmation." })
              : batchConfirm
                ? t("ai.agent.batchConfirmDesc")
                : t("ai.agent.confirmationRequiredDesc", { defaultValue: "Chaque action IA demande votre confirmation." })
          }
        >
          {autoApply
            ? t("ai.agent.autoApplyOn")
            : batchConfirm
              ? t("ai.agent.batchConfirmOn")
              : t("ai.agent.confirmationRequired")}
        </span>

        <span className="flex-1" />
        {usageLabel && (
          <span
            className="hidden shrink-0 rounded-md bg-muted/40 px-2 py-0.5 font-mono text-[10px] text-muted-foreground/70 @min-[22rem]:inline-flex"
            title={model ?? undefined}
          >
            {usageLabel}
            {model ? ` · ${model}` : ""}
          </span>
        )}
        <button
          type="button"
          onClick={onOpenRules}
          title={t("ai.agent.rules")}
          aria-label={t("ai.agent.rules")}
          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
          data-testid="ai-rules-button-header"
        >
          <FileText className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={onOpenPermissions}
          title={t("ai.agent.permissions")}
          aria-label={t("ai.agent.permissions")}
          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
          data-testid="ai-permissions-button-header"
        >
          <ShieldCheck className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setAdvancedOpen((open) => !open)}
          aria-expanded={advancedOpen}
          aria-controls="ai-agent-advanced-controls"
          className={cn(
            "flex h-7 shrink-0 items-center gap-1 rounded-lg px-2 text-[11px] font-medium transition-colors",
            advancedOpen
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
          )}
          data-testid="ai-controls-toggle"
        >
          <Settings2 className="size-3" />
          <span className="hidden @min-[24rem]:inline">{t("ai.agent.controls")}</span>
          <ChevronDown
            className={cn("size-3 transition-transform", advancedOpen && "rotate-180")}
          />
        </button>
      </div>

      {advancedOpen && (
        <div
          id="ai-agent-advanced-controls"
          className="flex flex-col gap-2 border-t border-border/40 px-3 py-2"
        >
          <p className="text-[11px] leading-snug text-muted-foreground">
            {t("ai.agent.controlsHelp", { defaultValue: "Auto = sans demande (sauf actions sensibles). Lot = un clic valide toute la file d'attente. Sinon chaque outil attend votre feu vert." })}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => onAutoApplyChange(!autoApply)}
            aria-pressed={autoApply}
            title={autoApply ? t("ai.agent.autoApplyOn") : t("ai.agent.confirmationRequired")}
            className={cn(
              "flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-medium transition-colors",
              autoApply
                ? "bg-warning/10 text-warning"
                : "bg-muted/40 text-muted-foreground hover:bg-accent/40 hover:text-foreground",
            )}
            data-testid="ai-autoapply-toggle"
          >
            <ShieldCheck className="size-3" />
            <span>
              {autoApply ? t("ai.agent.autoApplyOn") : t("ai.agent.confirmationRequired")}
            </span>
          </button>
          {onBatchConfirmChange && (
            <button
              type="button"
              onClick={() => onBatchConfirmChange(!batchConfirm)}
              aria-pressed={batchConfirm}
              disabled={autoApply}
              title={
                autoApply
                  ? t("ai.agent.batchConfirmMutedByAutoApply")
                  : t("ai.agent.batchConfirmDesc")
              }
              className={cn(
                "flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-medium transition-colors",
                autoApply && "cursor-not-allowed opacity-40",
                !autoApply &&
                  (batchConfirm
                    ? "bg-primary/10 text-primary"
                    : "bg-muted/40 text-muted-foreground hover:bg-accent/40 hover:text-foreground"),
              )}
              data-testid="ai-batch-confirm-toggle"
            >
              <ListChecks className="size-3" />
              <span>{t("ai.agent.batchConfirm")}</span>
            </button>
          )}
          <button
            type="button"
            onClick={onOpenRules}
            title={t("ai.agent.rules")}
            aria-label={t("ai.agent.rules")}
            className="flex h-7 items-center gap-1 rounded-lg bg-muted/40 px-2 text-[11px] text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground data-[active=true]:bg-primary/10 data-[active=true]:text-primary"
            data-testid="ai-rules-button"
          >
            <FileText className="size-3" />
            <span>{t("ai.agent.rulesShort")}</span>
          </button>
          <button
            type="button"
            onClick={onOpenPermissions}
            title={t("ai.agent.permissions")}
            aria-label={t("ai.agent.permissions")}
            className="flex h-7 items-center gap-1 rounded-lg bg-muted/40 px-2 text-[11px] text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground data-[active=true]:bg-primary/10 data-[active=true]:text-primary"
            data-testid="ai-permissions-button"
          >
            <ShieldCheck className="size-3" />
            <span>{t("ai.agent.accessShort")}</span>
          </button>
          </div>
        </div>
      )}
    </div>
  );
}

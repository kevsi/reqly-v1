"use client";
import { ListChecks, Zap, FileText, ShieldCheck } from "lucide-react";
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
}

/**
 * Barre de mode horizontale affichée sous le header de la sidebar IA.
 * Remplace les micro-icônes empilées dans le header — chaque contrôle
 * a un libellé visible et une surface cliquable correcte.
 */
export function AiAgentControls({
  mode,
  onModeChange,
  autoApply,
  onAutoApplyChange,
  onOpenRules,
  onOpenPermissions,
  sessionUsage,
}: Props) {
  const { t } = useTranslation();
  const usageLabel = sessionUsage ? formatTokens(sessionUsage) : null;

  return (
    <div
      className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border/60 bg-background/60 px-3 backdrop-blur-sm"
      data-testid="ai-agent-controls"
    >
      {/* ── Mode Plan / Act ─────────────────────────────────────── */}
      <div className="flex shrink-0 items-center rounded-lg border border-border/60 bg-muted/40 p-0.5">
        <button
          type="button"
          onClick={() => onModeChange("plan")}
          className={cn(
            "flex h-6 items-center gap-1 rounded-md px-2 text-[11px] font-medium transition-all duration-150",
            mode === "plan"
              ? "bg-primary text-primary-foreground shadow-sm"
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
          className={cn(
            "flex h-6 items-center gap-1 rounded-md px-2 text-[11px] font-medium transition-all duration-150",
            mode === "act"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
          title={t("ai.agent.actModeTitle")}
          data-testid="ai-mode-act"
        >
          <Zap className="size-3" />
          <span>{t("ai.agent.act")}</span>
        </button>
      </div>

      {/* ── Auto-apply ──────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => onAutoApplyChange(!autoApply)}
        title={
          autoApply
            ? "Auto-approbation activée — cliquer pour désactiver"
            : "Activer l'auto-approbation"
        }
        className={cn(
          "flex h-7 items-center gap-1 rounded-lg border px-2 text-[11px] font-medium transition-colors duration-150",
          autoApply
            ? "border-primary/40 bg-primary/10 text-primary shadow-[0_0_10px_-2px] shadow-primary/30"
            : "border-border/60 text-muted-foreground hover:bg-accent/50 hover:text-foreground",
        )}
        data-testid="ai-autoapply-toggle"
      >
        <Zap className="size-3" />
        <span className="@max-[26rem]:hidden">Auto</span>
      </button>

      {/* ── Séparateur ──────────────────────────────────────────── */}
      <span className="mx-0.5 h-4 w-px shrink-0 bg-border/60" aria-hidden />

      {/* ── Règles ──────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={onOpenRules}
        title={t("ai.agent.rules")}
        className="flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        data-testid="ai-rules-button"
      >
        <FileText className="size-3" />
        <span className="@max-[28rem]:hidden">{t("ai.agent.rulesShort")}</span>
      </button>

      {/* ── Permissions ─────────────────────────────────────────── */}
      <button
        type="button"
        onClick={onOpenPermissions}
        title={t("ai.agent.permissions")}
        className="flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        data-testid="ai-permissions-button"
      >
        <ShieldCheck className="size-3" />
        <span className="@max-[28rem]:hidden">{t("ai.agent.accessShort")}</span>
      </button>

      {/* ── Token usage (pousse à droite) ────────────────────────── */}
      {usageLabel && (
        <>
          <span className="flex-1" />
          <span className="shrink-0 rounded-md border border-border/50 bg-muted/50 px-2 py-0.5 font-mono text-[10px] text-muted-foreground/70">
            {usageLabel}
          </span>
        </>
      )}
    </div>
  );
}

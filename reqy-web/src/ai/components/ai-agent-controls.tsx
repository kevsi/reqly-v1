"use client";
import { ListChecks, Zap, FileText, ShieldCheck } from "lucide-react";
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
  const usageLabel = sessionUsage ? formatTokens(sessionUsage) : null;

  return (
    <div
      className="flex h-9 shrink-0 items-center gap-1 border-b border-border/60 bg-muted/20 px-3"
      data-testid="ai-agent-controls"
    >
      {/* ── Mode Plan / Act ─────────────────────────────────────── */}
      <div className="flex items-center rounded-md border border-border/60 bg-background p-0.5 shrink-0">
        <button
          type="button"
          onClick={() => onModeChange("plan")}
          className={cn(
            "flex h-6 items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors duration-150",
            mode === "plan"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
          title="Mode Plan — l'IA propose un plan avant d'agir"
          data-testid="ai-mode-plan"
        >
          <ListChecks className="size-3" />
          <span>Plan</span>
        </button>
        <button
          type="button"
          onClick={() => onModeChange("act")}
          className={cn(
            "flex h-6 items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors duration-150",
            mode === "act"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
          title="Mode Action — l'IA agit directement"
          data-testid="ai-mode-act"
        >
          <Zap className="size-3" />
          <span>Action</span>
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
          "flex h-6 items-center gap-1 rounded-md border px-2 text-[11px] font-medium transition-colors duration-150",
          autoApply
            ? "border-primary/40 bg-primary/10 text-primary"
            : "border-border/60 text-muted-foreground hover:text-foreground",
        )}
        data-testid="ai-autoapply-toggle"
      >
        <Zap className="size-3" />
        <span className="@max-[26rem]:hidden">Auto</span>
      </button>

      {/* ── Séparateur ──────────────────────────────────────────── */}
      <span className="mx-1 h-4 w-px bg-border/60 shrink-0" aria-hidden />

      {/* ── Règles ──────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={onOpenRules}
        title="Règles du workspace"
        className="flex h-6 items-center gap-1 rounded-md px-2 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        data-testid="ai-rules-button"
      >
        <FileText className="size-3" />
        <span className="@max-[28rem]:hidden">Règles</span>
      </button>

      {/* ── Permissions ─────────────────────────────────────────── */}
      <button
        type="button"
        onClick={onOpenPermissions}
        title="Permissions des outils"
        className="flex h-6 items-center gap-1 rounded-md px-2 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        data-testid="ai-permissions-button"
      >
        <ShieldCheck className="size-3" />
        <span className="@max-[28rem]:hidden">Accès</span>
      </button>

      {/* ── Token usage (pousse à droite) ────────────────────────── */}
      {usageLabel && (
        <>
          <span className="flex-1" />
          <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-mono text-muted-foreground/70 shrink-0">
            {usageLabel}
          </span>
        </>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Brain,
  Loader2,
  Wrench,
  FilePlus,
  Trash2,
  Play,
  Download,
  Upload,
  AlertCircle,
  CheckCircle2,
  HelpCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────

export interface AssistantStep {
  id: string;
  kind: "thinking" | "tool_call" | "result" | "error";
  label: string;
  status: "pending" | "done" | "error" | "awaiting_confirmation";
  icon: LucideIcon;
  detail?: string;
}

export type StepDisplayMode = "sequential" | "timeline";

export interface AssistantStepsRendererProps {
  steps: AssistantStep[];
  /** Texte de réponse final affiché après toutes les étapes "done". */
  finalText?: string;
  /**
   * "sequential" — seule l'étape en cours est visible (les étapes terminées disparaissent).
   * "timeline" — toutes les étapes sont affichées avec leur statut (défaut).
   * @default "sequential"
   */
  mode?: StepDisplayMode;
  /** Callback quand l'utilisateur confirme/annule une étape en attente. */
  onConfirm?: (stepId: string, confirmed: boolean) => void;
}

// ── Icon mapping (given a kind + status, returns the right icon) ───────────

export function iconForKind(
  kind: AssistantStep["kind"],
  status: AssistantStep["status"],
): LucideIcon {
  if (status === "error") return AlertCircle;
  if (status === "awaiting_confirmation") return HelpCircle;
  switch (kind) {
    case "thinking":
      return Brain;
    case "tool_call":
      return Wrench;
    case "result":
      return CheckCircle2;
    case "error":
      return AlertCircle;
    default:
      return Brain;
  }
}

/** Génère un libellé par défaut pour chaque kind. */
export function defaultLabelForKind(kind: AssistantStep["kind"], detail?: string): string {
  switch (kind) {
    case "thinking":
      return "Through…";
    case "tool_call":
      return detail ? `Exécution : ${detail}` : "Exécution…";
    case "result":
      return "Terminé";
    case "error":
      return "Erreur";
    default:
      return "Through…";
  }
}

// ── StepRow (une ligne d'étape) ────────────────────────────────────────────

function StepRow({
  step,
  isLast,
  onConfirm,
}: {
  step: AssistantStep;
  isLast: boolean;
  onConfirm?: (stepId: string, confirmed: boolean) => void;
}) {
  const [showDetail, setShowDetail] = useState(false);
  const isActive = step.status === "pending";
  const isError = step.status === "error";
  const Icon = isActive && step.kind === "thinking" ? Loader2 : step.icon;

  return (
    <div className="flex items-start gap-2 py-0.5 group">
      {/* Colonne icône */}
      <span className="relative flex items-center justify-center size-4 mt-0.5 shrink-0">
        <Icon
          className={cn(
            "size-4 transition-colors duration-200",
            isActive &&
              (step.kind === "thinking"
                ? "animate-spin text-foreground"
                : "animate-pulse text-foreground"),
            !isActive && !isError && "text-muted-foreground",
            isError && "text-destructive",
          )}
        />
        {/* Overlay check en bas à droite pour les steps done */}
        {step.status === "done" && (
          <CheckCircle2 className="absolute -bottom-0.5 -right-0.5 size-2.5 text-success bg-background rounded-full" />
        )}
      </span>

      {/* Colonne label + détail */}
      <div className="flex-1 min-w-0">
        <button
          type="button"
          onClick={() => step.detail && setShowDetail(!showDetail)}
          className={cn(
            "text-sm text-left w-full leading-snug transition-colors duration-200",
            isActive ? "text-foreground font-medium" : "text-muted-foreground",
            isError && "text-destructive font-medium",
            step.detail && "cursor-pointer hover:text-foreground",
            !step.detail && "cursor-default",
          )}
        >
          {step.label}
        </button>

        {/* Détail replié */}
        {showDetail && step.detail && (
          <p className="text-xs text-muted-foreground/70 mt-0.5 pl-2 border-l-2 border-border leading-relaxed whitespace-pre-wrap">
            {step.detail}
          </p>
        )}
      </div>

      {/* Indicateur "en cours" discret */}
      {isActive && (
        <span className="flex items-center gap-0.5 mt-1 shrink-0">
          <span className="size-0.5 rounded-full bg-foreground/60 animate-bounce [animation-delay:0ms]" />
          <span className="size-0.5 rounded-full bg-foreground/60 animate-bounce [animation-delay:150ms]" />
          <span className="size-0.5 rounded-full bg-foreground/60 animate-bounce [animation-delay:300ms]" />
        </span>
      )}

      {/* Boutons Confirmer/Annuler pour les étapes en attente de confirmation */}
      {step.status === "awaiting_confirmation" && onConfirm && (
        <div className="flex gap-1 ml-auto shrink-0">
          <Button
            type="button"
            variant="default"
            onClick={() => onConfirm(step.id, true)}
            className="h-auto gap-1 rounded bg-success px-2 py-1 text-[10px] font-semibold text-white hover:bg-success/90"
          >
            Confirmer
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onConfirm(step.id, false)}
            className="h-auto gap-1 rounded bg-muted-foreground/30 px-2 py-1 text-[10px] font-semibold text-foreground hover:bg-muted-foreground/50"
          >
            Annuler
          </Button>
        </div>
      )}
    </div>
  );
}

// ── AssistantStepsRenderer (conteneur principal) ───────────────────────────

export function AssistantStepsRenderer({
  steps,
  finalText,
  mode = "sequential",
  onConfirm,
}: AssistantStepsRendererProps) {
  const allDone =
    steps.length > 0 && steps.every((s) => s.status === "done" || s.status === "error");

  if (steps.length === 0 && !finalText) return null;

  // En mode "sequential", on montre uniquement la première étape non terminée.
  // Les étapes "done" disparaissent. Si tout est fini, on montre le texte final.
  const visibleSteps =
    mode === "sequential"
      ? (() => {
          const idx = steps.findIndex((s) => s.status !== "done" && s.status !== "error");
          return idx === -1 ? [] : [steps[idx]];
        })()
      : steps;

  // En mode sequential, si aucune étape visible et pas de finalText, on masque tout
  if (mode === "sequential" && visibleSteps.length === 0 && !finalText) return null;
  // Si en mode sequential et tout est done, ne montrer que le finalText
  if (mode === "sequential" && visibleSteps.length === 0 && allDone && !finalText) return null;

  return (
    <div className="space-y-0">
      {/* Étapes visibles */}
      {visibleSteps.length > 0 && (
        <div className={cn(mode === "sequential" ? "flex flex-col" : "flex flex-col gap-0")}>
          {visibleSteps.map((step, i) => (
            <StepRow
              key={step.id}
              step={step}
              isLast={allDone || i === visibleSteps.length - 1}
              onConfirm={onConfirm}
            />
          ))}
        </div>
      )}

      {/* Texte final — affiché seulement une fois toutes les étapes terminées */}
      {allDone && finalText && (
        <div
          className={cn(
            "text-sm text-foreground leading-relaxed whitespace-pre-wrap",
            mode === "sequential" && visibleSteps.length === 0
              ? ""
              : "mt-2 pt-2 border-t border-border/40",
          )}
        >
          {finalText}
        </div>
      )}
    </div>
  );
}

/**
 * Convertit un tableau ProcessStep (venant de l'IA engine) en AssistantStep[]
 * pour le composant AssistantStepsRenderer.
 */
export interface ProcessStep {
  type: "through" | "fill" | "execute" | "create" | "edit" | "done" | "error";
  label: string;
  status: "pending" | "in_progress" | "done" | "error";
}

export function toAssistantSteps(steps: ProcessStep[]): AssistantStep[] {
  const kindMap: Record<string, AssistantStep["kind"]> = {
    through: "thinking",
    fill: "tool_call",
    execute: "result",
    create: "tool_call",
    edit: "tool_call",
    done: "result",
    error: "error",
  };
  return steps.map((s, i) => {
    const kind = kindMap[s.type] ?? "thinking";
    const status: AssistantStep["status"] = s.status === "in_progress" ? "pending" : s.status;
    return {
      id: `ps-${i}-${Date.now()}`,
      kind,
      label: s.label,
      status,
      icon: iconForKind(kind, status),
    };
  });
}

// ── Helper pour construire des étapes facilement ───────────────────────────

let _stepCounter = 0;

export function buildStep(
  overrides: Partial<AssistantStep> & { kind: AssistantStep["kind"] },
): AssistantStep {
  _stepCounter++;
  const kind = overrides.kind;
  const defaultIcon = iconForKind(kind, overrides.status ?? "pending");
  const defaultLabel = defaultLabelForKind(kind, overrides.detail);
  return {
    id: `step-${_stepCounter}-${Date.now()}`,
    status: overrides.status ?? "pending",
    icon: overrides.icon ?? defaultIcon,
    label: overrides.label ?? defaultLabel,
    detail: overrides.detail,
    kind: overrides.kind,
  };
}

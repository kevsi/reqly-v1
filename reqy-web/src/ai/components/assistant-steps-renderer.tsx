"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  BrainCircuit,
  Loader2,
  Wrench,
  CheckCircle2,
  CircleAlert,
  ShieldQuestion,
  Check,
  X,
  ChevronDown,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { AiMarkdown } from "@/src/ai/components/ai-markdown";

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
  /**
   * Permet de replier automatiquement la timeline en une ligne résumée dès que
   * toutes les étapes sont terminées (clic pour rouvrir).
   * @default false
   */
  collapsible?: boolean;
}

// ── Icon mapping (given a kind + status, returns the right icon) ───────────

export function iconForKind(
  kind: AssistantStep["kind"],
  status: AssistantStep["status"],
): LucideIcon {
  if (status === "error") return CircleAlert;
  if (status === "awaiting_confirmation") return ShieldQuestion;
  switch (kind) {
    case "thinking":
      return BrainCircuit;
    case "tool_call":
      return Wrench;
    case "result":
      return CheckCircle2;
    case "error":
      return CircleAlert;
    default:
      return BrainCircuit;
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
  const isAwaiting = step.status === "awaiting_confirmation";
  const Icon = isActive && step.kind === "thinking" ? Loader2 : step.icon;

  const isDone = step.status === "done";
  const badge = cn(
    "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md ring-1 transition-colors duration-300",
    isError && "bg-destructive/10 text-destructive ring-destructive/20",
    isAwaiting && "bg-warning/10 text-warning ring-warning/25",
    isActive && "bg-primary/10 text-primary ring-primary/25",
    isDone && "bg-success/10 text-success ring-success/25",
    !isActive && !isError && !isAwaiting && !isDone && "bg-muted text-muted-foreground ring-border/60",
  );

  return (
    <div className="flex items-stretch gap-2">
      {/* Colonne icône + connecteur vertical */}
      <div className="flex flex-col items-center">
        <span className={badge}>
          <Icon
            className={cn(
              "size-3",
              isActive && step.kind === "thinking" && "animate-spin",
              isActive && step.kind !== "thinking" && "animate-pulse",
            )}
          />
        </span>
        {!isLast && <span className="my-1 w-px flex-1 bg-border/50" aria-hidden />}
      </div>

      {/* Colonne label + détail + actions */}
      <div className="min-w-0 flex-1 pb-1">
        <div className="flex items-center gap-1.5">
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

          {/* Indicateur "en cours" discret */}
          {isActive && (
            <span className="flex shrink-0 items-center gap-0.5">
              <span className="size-0.5 rounded-full bg-foreground/60 animate-bounce [animation-delay:0ms]" />
              <span className="size-0.5 rounded-full bg-foreground/60 animate-bounce [animation-delay:150ms]" />
              <span className="size-0.5 rounded-full bg-foreground/60 animate-bounce [animation-delay:300ms]" />
            </span>
          )}

          {/* Chip "en attente de confirmation" */}
          {isAwaiting && (
            <span className="shrink-0 rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning ring-1 ring-warning/25">
              En attente de confirmation
            </span>
          )}
        </div>

        {/* Détail replié */}
        {showDetail && step.detail && (
          <p className="mt-0.5 pl-2 border-l-2 border-border text-xs text-muted-foreground/70 leading-relaxed whitespace-pre-wrap">
            {step.detail}
          </p>
        )}

        {/* Boutons Confirmer/Annuler pour les étapes en attente de confirmation */}
        {isAwaiting && onConfirm && (
          <div className="mt-1.5 flex gap-1.5">
            <Button
              type="button"
              variant="default"
              onClick={() => onConfirm(step.id, true)}
              className="h-auto gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold text-white"
            >
              <Check className="size-3" />
              Confirmer
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => onConfirm(step.id, false)}
              className="h-auto gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" />
              Annuler
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── AssistantStepsRenderer (conteneur principal) ───────────────────────────

export function AssistantStepsRenderer({
  steps,
  finalText,
  mode = "sequential",
  onConfirm,
  collapsible = false,
}: AssistantStepsRendererProps) {
  const allDone =
    steps.length > 0 && steps.every((s) => s.status === "done" || s.status === "error");
  const [collapsed, setCollapsed] = useState(false);

  // Replie automatiquement la timeline dès que tout est terminé, et la rouvre
  // quand une nouvelle exécution démarre (mode repliable uniquement).
  useEffect(() => {
    if (!collapsible) return;
    setCollapsed(allDone);
  }, [collapsible, allDone]);

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

  const canCollapse = collapsible && allDone && steps.length > 0;
  const execCount = steps.filter((s) => s.kind !== "thinking").length;
  const errorCount = steps.filter((s) => s.status === "error").length;

  return (
    <div className="space-y-0">
      {/* Ligne résumée — affichée une fois tout terminé en mode repliable */}
      {canCollapse && (
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center gap-1.5 rounded-md px-1 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-expanded={!collapsed}
          data-testid="ai-steps-toggle"
        >
          {errorCount > 0 ? (
            <CircleAlert className="size-3.5 text-destructive" />
          ) : (
            <CheckCircle2 className="size-3.5 text-success" />
          )}
          <span>
            {execCount > 0
              ? `${execCount} exécution${execCount > 1 ? "s" : ""} terminée${execCount > 1 ? "s" : ""}`
              : "Étapes terminées"}
            {errorCount > 0 && ` · ${errorCount} erreur${errorCount > 1 ? "s" : ""}`}
          </span>
          <ChevronDown
            className={cn("size-3.5 transition-transform duration-200", collapsed && "-rotate-90")}
          />
        </button>
      )}

      {/* Étapes visibles — masquées quand la timeline est repliée */}
      {visibleSteps.length > 0 && !collapsed && (
        <div className="flex flex-col">
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
            mode === "sequential" && visibleSteps.length === 0
              ? ""
              : "mt-2 pt-2 border-t border-border/40",
          )}
        >
          <AiMarkdown content={finalText} />
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
  status: "pending" | "in_progress" | "done" | "error" | "awaiting_confirmation";
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

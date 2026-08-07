"use client";

import { useState } from "react";
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
  ChevronRight,
  Clock,
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
    !isActive &&
      !isError &&
      !isAwaiting &&
      !isDone &&
      "bg-muted text-muted-foreground ring-border/60",
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

// ── Parsing d'un détail d'exécution HTTP ─────────────────────────────────

interface ParsedExecution {
  method: string;
  url: string;
  status: number | null;
  durationMs: number | null;
  body: string;
}

/** Analyse le detail d'un step execute_request, au format:
 *  `GET https://api.example.com/users → 200 en 42ms\n{body}` */
export function parseExecutionDetail(detail?: string): ParsedExecution | null {
  if (!detail) return null;
  const m = detail.match(/^([A-Z]+)\s+(\S+)\s+→\s+(\d{3})(?:\s+en\s+(\d+)ms)?(?:\n([\s\S]*))?$/i);
  if (!m) return null;
  return {
    method: m[1].toUpperCase(),
    url: m[2],
    status: Number(m[3]),
    durationMs: m[4] ? Number(m[4]) : null,
    body: (m[5] ?? "").trim(),
  };
}

const METHOD_COLORS: Record<string, string> = {
  GET: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 ring-emerald-500/25",
  POST: "bg-sky-500/15 text-sky-600 dark:text-sky-400 ring-sky-500/25",
  PUT: "bg-amber-500/15 text-amber-600 dark:text-amber-400 ring-amber-500/25",
  PATCH: "bg-orange-500/15 text-orange-600 dark:text-orange-400 ring-orange-500/25",
  DELETE: "bg-red-500/15 text-red-600 dark:text-red-400 ring-red-500/25",
};

function statusTone(status: number) {
  if (status < 300)
    return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 ring-emerald-500/25";
  if (status < 500) return "bg-amber-500/15 text-amber-600 dark:text-amber-400 ring-amber-500/25";
  return "bg-red-500/15 text-red-600 dark:text-red-400 ring-red-500/25";
}

// ── ExecutionCard (carte premium d'une exécution HTTP) ─────────────────────

function ExecutionCard({ step, isLast }: { step: AssistantStep; isLast: boolean }) {
  const [open, setOpen] = useState(false);
  const exec = parseExecutionDetail(step.detail);
  const isError = step.status === "error";
  const isDone = step.status === "done";

  const statusLabel = isError ? "Erreur" : isDone ? "Terminé" : "En cours…";
  const statusColor = isError
    ? "text-destructive bg-destructive/10 ring-destructive/20"
    : isDone
      ? "text-success bg-success/10 ring-success/25"
      : "text-primary bg-primary/10 ring-primary/25";

  return (
    <div className="flex items-stretch gap-2">
      {/* Connecteur de timeline */}
      <div className="flex flex-col items-center">
        <span
          className={cn(
            "mt-1 flex size-5 shrink-0 items-center justify-center rounded-lg ring-1",
            isError
              ? "bg-destructive/10 text-destructive ring-destructive/20"
              : "bg-success/10 text-success ring-success/25",
          )}
        >
          {isError ? (
            <CircleAlert className="size-3" />
          ) : isDone ? (
            <Check className="size-3" />
          ) : (
            <Loader2 className="size-3 animate-spin" />
          )}
        </span>
        {!isLast && <span className="my-1 w-px flex-1 bg-border/50" aria-hidden />}
      </div>

      {/* Carte = arbre imbriqué */}
      <div className="mb-1.5 min-w-0 flex-1 overflow-hidden rounded-2xl border border-border/60 bg-card/60 shadow-sm">
        {/* ── Parent : requête + statut ── */}
        <button
          type="button"
          onClick={() => exec && setOpen(!open)}
          className={cn(
            "flex w-full items-center gap-2 px-3 py-2.5 text-left",
            exec && "cursor-pointer hover:bg-accent/30 transition-colors",
          )}
        >
          {exec && (
            <ChevronDown
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
                open && "rotate-180",
              )}
            />
          )}
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {exec ? (
              <>
                <span
                  className={cn(
                    "rounded-lg px-2 py-0.5 font-mono text-[10px] font-bold ring-1",
                    METHOD_COLORS[exec.method] ?? "bg-muted text-muted-foreground ring-border/60",
                  )}
                >
                  {exec.method}
                </span>
                <span className="max-w-[200px] truncate font-mono text-[12px] text-foreground">
                  {exec.url}
                </span>
                {exec.status != null && (
                  <span
                    className={cn(
                      "rounded-lg px-2 py-0.5 font-mono text-[10px] font-bold ring-1",
                      statusTone(exec.status),
                    )}
                  >
                    {exec.status}
                  </span>
                )}
              </>
            ) : (
              <span className="text-sm font-medium">{step.label || statusLabel}</span>
            )}
          </span>
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1",
              statusColor,
            )}
          >
            {!isDone && !isError && <Loader2 className="size-2.5 animate-spin" />}
            {statusLabel}
          </span>
        </button>

        {/* ── Enfants (détails imbriqués) ── */}
        {exec && !isError && (
          <div
            className={cn(
              "overflow-hidden transition-all duration-200",
              open ? "max-h-64" : "max-h-0",
            )}
          >
            <div className="mx-3 mb-3 flex gap-3">
              {/* Rail gauche */}
              <div className="flex flex-col items-center">
                <span className="w-px flex-1 bg-primary/30" />
                <span className="my-1 size-1 rounded-full bg-primary/50" />
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                {/* Métadonnées */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {exec.durationMs != null && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Clock className="size-3" />
                      {exec.durationMs} ms
                    </span>
                  )}
                </div>
                {/* Réponse / résumé */}
                {(exec.body || step.label) && (
                  <div>
                    <p
                      className={cn(
                        "whitespace-pre-wrap break-words rounded-lg bg-muted/30 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground",
                        !open && "line-clamp-3",
                      )}
                    >
                      {exec.body || step.label}
                    </p>
                    <span className="mt-1 inline-flex items-center gap-0.5 text-[10px] font-medium text-primary">
                      <ChevronRight className="size-3" />
                      {open ? "Réduire" : "Voir le détail"}
                    </span>
                  </div>
                )}
              </div>
            </div>
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
  // Replie automatiquement la timeline dès que tout est terminé, mais laisse
  // l'utilisateur la rouvrir manuellement (override persistant entre les rendus).
  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  const collapsed = collapsible && (userToggled ?? allDone);

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
          onClick={() => setUserToggled(!collapsed)}
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
          {visibleSteps.map((step, i) =>
            step.detail && parseExecutionDetail(step.detail) ? (
              <ExecutionCard
                key={step.id}
                step={step}
                isLast={allDone || i === visibleSteps.length - 1}
              />
            ) : (
              <StepRow
                key={step.id}
                step={step}
                isLast={allDone || i === visibleSteps.length - 1}
                onConfirm={onConfirm}
              />
            ),
          )}
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
  type: "through" | "fill" | "execute" | "create" | "edit" | "done" | "error" | "pause";
  label: string;
  status: "pending" | "in_progress" | "done" | "error" | "awaiting_confirmation";
  /** Données brutes de résultat (ex. sortie du tool execute_request). */
  detail?: string;
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
    pause: "result",
  };
  return steps.map((s, i) => {
    const kind = kindMap[s.type] ?? "thinking";
    const status: AssistantStep["status"] = s.status === "in_progress" ? "pending" : s.status;
    return {
      id: `ps-${i}`,
      kind,
      label: s.label,
      status,
      detail: s.detail,
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

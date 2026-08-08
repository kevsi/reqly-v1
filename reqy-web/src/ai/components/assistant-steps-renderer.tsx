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
  FolderPlus,
  List,
  FilePlus,
  Zap,
  FileEdit,
  Trash2,
  Play,
  Pause,
  Globe,
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
  finalText?: string;
  mode?: StepDisplayMode;
  onConfirm?: (stepId: string, confirmed: boolean) => void;
  collapsible?: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const TOOL_ICONS: Record<string, LucideIcon> = {
  list_collections: List,
  list_requests: List,
  list_environments: List,
  create_collection: FolderPlus,
  create_request: FilePlus,
  create_environment: FolderPlus,
  edit_request: FileEdit,
  edit_collection: FileEdit,
  execute_request: Zap,
  run_request: Play,
  delete_collection: Trash2,
  delete_request: Trash2,
  navigate: Globe,
};

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

/** Parse "create_collection({name: 'foo'})" → { name, args } */
function parseToolLabel(label: string): { name: string; args: string } | null {
  const m = label.match(/^(\w+)\(([\s\S]*)\)$/);
  if (!m) return null;
  return { name: m[1], args: m[2].trim() };
}

// ── ThinkingRow — animated "Through…" step ─────────────────────────────────

function ThinkingRow({ step }: { step: AssistantStep }) {
  const isActive = step.status === "pending";
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-xl border px-3 py-2.5",
        "animate-in slide-in-from-left-2 fade-in duration-300",
        isActive
          ? "border-primary/20 bg-gradient-to-r from-primary/5 to-transparent"
          : "border-border/40 bg-card/30",
      )}
    >
      <span
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-lg ring-1",
          isActive
            ? "bg-primary/10 text-primary ring-primary/25"
            : "bg-muted text-muted-foreground ring-border/50",
        )}
      >
        {isActive ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
      </span>
      <span
        className={cn(
          "flex-1 text-sm italic",
          isActive ? "text-foreground/70" : "text-muted-foreground/60 line-through",
        )}
      >
        {step.label}
      </span>
      {isActive && (
        <span className="flex shrink-0 items-center gap-0.5">
          <span className="size-1 rounded-full bg-primary/50 animate-bounce [animation-delay:0ms]" />
          <span className="size-1 rounded-full bg-primary/50 animate-bounce [animation-delay:120ms]" />
          <span className="size-1 rounded-full bg-primary/50 animate-bounce [animation-delay:240ms]" />
        </span>
      )}
    </div>
  );
}

// ── ToolRow — card style per tool call ─────────────────────────────────────

function ToolRow({
  step,
  isLast,
  onConfirm,
}: {
  step: AssistantStep;
  isLast: boolean;
  onConfirm?: (stepId: string, confirmed: boolean) => void;
}) {
  const parsed = parseToolLabel(step.label);
  const ToolIcon = (parsed ? (TOOL_ICONS[parsed.name] ?? Wrench) : Wrench) as LucideIcon;

  const isActive = step.status === "pending";
  const isError = step.status === "error";
  const isAwaiting = step.status === "awaiting_confirmation";
  const isDone = step.status === "done";

  const badgeCls = cn(
    "mt-1 flex size-6 shrink-0 items-center justify-center rounded-lg ring-1 transition-colors duration-300",
    isDone && "bg-success/10 text-success ring-success/25",
    isError && "bg-destructive/10 text-destructive ring-destructive/20",
    isAwaiting && "bg-warning/10 text-warning ring-warning/25",
    isActive && "bg-primary/10 text-primary ring-primary/25",
  );

  const statusLabel = isDone ? "fait" : isError ? "erreur" : isAwaiting ? "en attente" : "…";
  const statusCls = cn(
    "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1",
    isDone && "bg-success/10 text-success ring-success/25",
    isError && "bg-destructive/10 text-destructive ring-destructive/20",
    isAwaiting && "bg-warning/10 text-warning ring-warning/25",
    isActive && "bg-primary/10 text-primary ring-primary/25",
  );

  return (
    <div className="flex items-stretch gap-2 animate-in slide-in-from-left-2 fade-in duration-300">
      {/* Timeline spine */}
      <div className="flex flex-col items-center">
        <span className={badgeCls}>
          <ToolIcon className={cn("size-3", isActive && "animate-pulse")} />
        </span>
        {!isLast && (
          <span
            className={cn(
              "my-1 w-px flex-1 transition-colors duration-500",
              isDone ? "bg-success/30" : "bg-border/40",
            )}
            aria-hidden
          />
        )}
      </div>

      {/* Card */}
      <div className="mb-1.5 min-w-0 flex-1">
        <div
          className={cn(
            "flex items-start gap-2 rounded-xl border px-3 py-2 transition-colors duration-300",
            isDone && "border-success/15 bg-success/[0.03]",
            isError && "border-destructive/20 bg-destructive/[0.03]",
            isActive && "border-primary/20 bg-primary/[0.04]",
            isAwaiting && "border-warning/20 bg-warning/[0.04]",
            !isActive && !isError && !isAwaiting && !isDone && "border-border/50 bg-card/40",
          )}
        >
          <div className="min-w-0 flex-1">
            {parsed ? (
              <>
                <span className="font-mono text-[13px] font-semibold text-foreground">
                  {parsed.name}
                </span>
                {parsed.args && parsed.args !== "{}" && (
                  <p className="mt-0.5 truncate font-mono text-[10px] leading-relaxed text-muted-foreground/60">
                    {parsed.args}
                  </p>
                )}
              </>
            ) : (
              <span className="text-sm text-foreground">{step.label}</span>
            )}
          </div>
          <span className={statusLabel !== "…" || isActive ? statusCls : "hidden"}>
            {isActive ? <Loader2 className="size-2.5 animate-spin" /> : statusLabel}
          </span>
        </div>

        {/* Awaiting confirmation actions */}
        {isAwaiting && onConfirm && (
          <div className="mt-1.5 flex gap-1.5 pl-1">
            <Button
              type="button"
              variant="default"
              onClick={() => onConfirm(step.id, true)}
              className="h-auto gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold text-white"
            >
              <Check className="size-3" /> Confirmer
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => onConfirm(step.id, false)}
              className="h-auto gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" /> Annuler
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Parsing HTTP execution detail ─────────────────────────────────────────

interface ParsedExecution {
  method: string;
  url: string;
  status: number | null;
  durationMs: number | null;
  body: string;
}

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

function statusTone(s: number) {
  if (s < 300)
    return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 ring-emerald-500/25";
  if (s < 500) return "bg-amber-500/15 text-amber-600 dark:text-amber-400 ring-amber-500/25";
  return "bg-red-500/15 text-red-600 dark:text-red-400 ring-red-500/25";
}

// ── ExecutionCard — rich HTTP request card ─────────────────────────────────

function ExecutionCard({ step, isLast }: { step: AssistantStep; isLast: boolean }) {
  const [open, setOpen] = useState(false);
  const exec = parseExecutionDetail(step.detail);
  const isError = step.status === "error";
  const isDone = step.status === "done";
  const isPending = step.status === "pending";

  return (
    <div className="flex items-stretch gap-2 animate-in slide-in-from-left-2 fade-in duration-300">
      <div className="flex flex-col items-center">
        <span
          className={cn(
            "mt-1 flex size-6 shrink-0 items-center justify-center rounded-lg ring-1",
            isError
              ? "bg-destructive/10 text-destructive ring-destructive/20"
              : isDone
                ? "bg-success/10 text-success ring-success/25"
                : "bg-primary/10 text-primary ring-primary/25",
          )}
        >
          {isError ? (
            <CircleAlert className="size-3" />
          ) : isPending ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Check className="size-3" />
          )}
        </span>
        {!isLast && <span className="my-1 w-px flex-1 bg-border/40" aria-hidden />}
      </div>

      <div className="mb-1.5 min-w-0 flex-1 overflow-hidden rounded-2xl border border-border/60 bg-card/60 shadow-sm">
        <button
          type="button"
          onClick={() => exec && setOpen(!open)}
          className={cn(
            "flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors",
            exec && "cursor-pointer hover:bg-accent/30",
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
                <span className="max-w-[180px] truncate font-mono text-[12px] text-foreground">
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
                {exec.durationMs != null && (
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
                    <Clock className="size-2.5" />
                    {exec.durationMs}ms
                  </span>
                )}
              </>
            ) : (
              <span className="font-mono text-sm font-semibold">{step.label}</span>
            )}
          </span>
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1",
              isError
                ? "bg-destructive/10 text-destructive ring-destructive/20"
                : isDone
                  ? "bg-success/10 text-success ring-success/25"
                  : "bg-primary/10 text-primary ring-primary/25",
            )}
          >
            {isPending && <Loader2 className="size-2.5 animate-spin" />}
            {isDone && "✓ fait"}
            {isError && "✗ erreur"}
          </span>
        </button>

        {exec && !isError && (
          <div
            className={cn(
              "overflow-hidden transition-all duration-200",
              open ? "max-h-64" : "max-h-0",
            )}
          >
            <div className="mx-3 mb-3 flex gap-3">
              <div className="flex flex-col items-center">
                <span className="w-px flex-1 bg-primary/20" />
                <span className="my-1 size-1 rounded-full bg-primary/40" />
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                {exec.body && (
                  <p className="whitespace-pre-wrap break-words rounded-lg bg-muted/30 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
                    {exec.body}
                  </p>
                )}
                <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-primary">
                  <ChevronRight className="size-3" />
                  {open ? "Réduire" : "Voir le détail"}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── AssistantStepsRenderer ─────────────────────────────────────────────────

export function AssistantStepsRenderer({
  steps,
  finalText,
  mode = "sequential",
  onConfirm,
  collapsible = false,
}: AssistantStepsRendererProps) {
  const allDone =
    steps.length > 0 && steps.every((s) => s.status === "done" || s.status === "error");
  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  const collapsed = collapsible && (userToggled ?? allDone);

  if (steps.length === 0 && !finalText) return null;

  const visibleSteps =
    mode === "sequential"
      ? (() => {
          const idx = steps.findIndex((s) => s.status !== "done" && s.status !== "error");
          return idx === -1 ? [] : [steps[idx]];
        })()
      : steps;

  if (mode === "sequential" && visibleSteps.length === 0 && !finalText) return null;

  const canCollapse = collapsible && allDone && steps.length > 0;
  const toolSteps = steps.filter((s) => s.kind !== "thinking");
  const errorCount = steps.filter((s) => s.status === "error").length;

  // Mini badges for collapsed summary: group by tool name
  const toolCounts = toolSteps.reduce<Record<string, number>>((acc, s) => {
    const parsed = parseToolLabel(s.label);
    const key = parsed?.name ?? s.label;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-0">
      {/* Collapsed summary */}
      {canCollapse && (
        <button
          type="button"
          onClick={() => setUserToggled(!collapsed)}
          className="flex flex-wrap items-center gap-1.5 rounded-lg px-1 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-expanded={!collapsed}
          data-testid="ai-steps-toggle"
        >
          {errorCount > 0 ? (
            <CircleAlert className="size-3.5 text-destructive" />
          ) : (
            <CheckCircle2 className="size-3.5 text-success" />
          )}
          <span className="font-medium">
            {toolSteps.length > 0
              ? `${toolSteps.length} exécution${toolSteps.length > 1 ? "s" : ""} terminée${toolSteps.length > 1 ? "s" : ""}`
              : "Terminé"}
          </span>
          {Object.entries(toolCounts)
            .slice(0, 4)
            .map(([name, count]) => (
              <span
                key={name}
                className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground ring-1 ring-border/50"
              >
                {count > 1 ? `${name} ×${count}` : name}
              </span>
            ))}
          <ChevronDown
            className={cn(
              "ml-0.5 size-3.5 transition-transform duration-200",
              collapsed && "-rotate-90",
            )}
          />
        </button>
      )}

      {/* Steps */}
      {visibleSteps.length > 0 && !collapsed && (
        <div className="flex flex-col gap-0.5">
          {visibleSteps.map((step, i) => {
            const isLast = allDone || i === visibleSteps.length - 1;
            if (step.kind === "thinking") return <ThinkingRow key={step.id} step={step} />;
            if (step.detail && parseExecutionDetail(step.detail))
              return <ExecutionCard key={step.id} step={step} isLast={isLast} />;
            return <ToolRow key={step.id} step={step} isLast={isLast} onConfirm={onConfirm} />;
          })}
        </div>
      )}

      {/* Final text */}
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

// ── ProcessStep types + adapters ───────────────────────────────────────────

export interface ProcessStep {
  type: "through" | "fill" | "execute" | "create" | "edit" | "done" | "error" | "pause";
  label: string;
  status: "pending" | "in_progress" | "done" | "error" | "awaiting_confirmation";
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

let _stepCounter = 0;

export function buildStep(
  overrides: Partial<AssistantStep> & { kind: AssistantStep["kind"] },
): AssistantStep {
  _stepCounter++;
  const kind = overrides.kind;
  return {
    id: `step-${_stepCounter}-${Date.now()}`,
    status: overrides.status ?? "pending",
    icon: overrides.icon ?? iconForKind(kind, overrides.status ?? "pending"),
    label: overrides.label ?? defaultLabelForKind(kind, overrides.detail),
    detail: overrides.detail,
    kind,
  };
}

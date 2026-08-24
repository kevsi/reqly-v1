"use client";

import { useMemo } from "react";
import { RotateCcw } from "lucide-react";
import type { MockRoute } from "@reqly/mock-engine";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { HTTP_METHODS, normalizeMethod } from "./mock-utils";
import { ROUTE_TRAITS, type RouteTrait } from "./trait-icons";

const K = {
  count: "mocks.filters.count",
  reset: "mocks.filters.reset",
  methodAria: "mocks.filters.methodAria",
  traitAria: "mocks.filters.traitAria",
  traitLatency: "mocks.filters.traitLatency",
  traitFailure: "mocks.filters.traitFailure",
  traitStateful: "mocks.filters.traitStateful",
  traitTransform: "mocks.filters.traitTransform",
  traitDisabled: "mocks.filters.traitDisabled",
  traitConditional: "mocks.filters.traitConditional",
} as const;

const TRAIT_FALLBACKS: Record<RouteTrait, string> = {
  latency: "latence",
  failure: "panne",
  stateful: "stateful",
  transform: "transform",
  disabled: "désactivée",
  conditional: "conditionnelle",
};

const TRAIT_KEYS: Record<RouteTrait, string> = {
  latency: K.traitLatency,
  failure: K.traitFailure,
  stateful: K.traitStateful,
  transform: K.traitTransform,
  disabled: K.traitDisabled,
  conditional: K.traitConditional,
};

interface RouteFiltersProps {
  routes: MockRoute[];
  filteredCount: number;
  methods: ReadonlySet<string>;
  traits: ReadonlySet<RouteTrait>;
  onToggleMethod: (method: string) => void;
  onToggleTrait: (trait: RouteTrait) => void;
  onReset: () => void;
}

export function RouteFilters({
  routes,
  filteredCount,
  methods,
  traits,
  onToggleMethod,
  onToggleTrait,
  onReset,
}: RouteFiltersProps) {
  const { t } = useTranslation();

  const methodCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const route of routes) {
      const m = normalizeMethod(String(route.method));
      counts.set(m, (counts.get(m) ?? 0) + 1);
    }
    return counts;
  }, [routes]);

  const traitCounts = useMemo(() => {
    const counts = new Map<RouteTrait, number>();
    for (const def of ROUTE_TRAITS) {
      counts.set(def.id, routes.reduce((acc, r) => acc + (def.has(r) ? 1 : 0), 0));
    }
    return counts;
  }, [routes]);

  const active = methods.size > 0 || traits.size > 0;

  return (
    <div className="flex flex-col gap-1.5 border-b px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label={t(K.methodAria, { defaultValue: "Filtrer par méthode" })}>
          {HTTP_METHODS.filter((m) => (methodCounts.get(m) ?? 0) > 0).map((method) => (
            <FilterChip
              key={method}
              active={methods.has(method)}
              label={String(methodCounts.get(method) ?? 0)}
              title={method}
              ariaLabel={`${t(K.methodAria, { defaultValue: "Filtrer par méthode" })} ${method}`}
              onClick={() => onToggleMethod(method)}
              mono
            >
              {method}
            </FilterChip>
          ))}
        </div>
        <span
          className="font-mono text-[10px] whitespace-nowrap text-muted-foreground"
          title={t(K.count, { defaultValue: "{{filtered}}/{{total}} routes", filtered: filteredCount, total: routes.length })}
        >
          {filteredCount}/{routes.length}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <div className="flex flex-wrap gap-1" role="group" aria-label={t(K.traitAria, { defaultValue: "Filtrer par trait" })}>
          {ROUTE_TRAITS.filter((def) => (traitCounts.get(def.id) ?? 0) > 0).map((def) => (
            <FilterChip
              key={def.id}
              active={traits.has(def.id)}
              label={String(traitCounts.get(def.id) ?? 0)}
              title={t(TRAIT_KEYS[def.id], { defaultValue: TRAIT_FALLBACKS[def.id] })}
              ariaLabel={t(TRAIT_KEYS[def.id], { defaultValue: TRAIT_FALLBACKS[def.id] })}
              onClick={() => onToggleTrait(def.id)}
            >
              <span aria-hidden="true" className="flex items-center">{def.icon}</span>
            </FilterChip>
          ))}
        </div>
        {active && (
          <button
            type="button"
            onClick={onReset}
            className="ml-auto flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-[10px] text-muted-foreground transition-all duration-150 hover:border-destructive/40 hover:text-destructive"
            aria-label={t(K.reset, { defaultValue: "Réinitialiser les filtres" })}
            title={t(K.reset, { defaultValue: "Réinitialiser les filtres" })}
          >
            <RotateCcw aria-hidden="true" className="size-2.5" />
            {t(K.reset, { defaultValue: "Réinitialiser" })}
          </button>
        )}
      </div>
    </div>
  );
}

function FilterChip({
  active,
  label,
  title,
  ariaLabel,
  mono,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  title: string;
  ariaLabel: string;
  mono?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      aria-pressed={active}
      className={cn(
        "flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] transition-all duration-150 focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
        mono && "font-mono font-semibold",
        active
          ? "border-primary/50 bg-primary/15 text-primary"
          : "border-border bg-accent/30 text-muted-foreground hover:border-primary/30 hover:text-foreground",
      )}
    >
      {children}
      <span className="text-muted-foreground/80">{label}</span>
    </button>
  );
}

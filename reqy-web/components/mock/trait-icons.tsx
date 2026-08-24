"use client";

import type { ReactNode } from "react";
import { ArrowLeftRight, Ban, Clock, Code, Database, Zap } from "lucide-react";
import type { MockRoute } from "@reqly/mock-engine";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTranslation } from "react-i18next";

export type RouteTrait =
  | "latency"
  | "failure"
  | "stateful"
  | "transform"
  | "disabled"
  | "conditional";

interface TraitLabel {
  key: string;
  fallback: string;
  values?: Record<string, unknown>;
}

interface RouteTraitDef {
  id: RouteTrait;
  icon: ReactNode;
  has: (route: MockRoute) => boolean;
  label: (route: MockRoute) => TraitLabel;
}

const FALLBACKS: Record<RouteTrait, string> = {
  latency: "Latence {{min}}–{{max}} ms",
  failure: "Panne {{percent}} % · {{kind}}",
  stateful: "Stateful",
  transform: "Transform JS",
  disabled: "Désactivée",
  conditional: "Conditionnelle",
};

export const ROUTE_TRAITS: ReadonlyArray<RouteTraitDef> = [
  {
    id: "latency",
    icon: <Clock aria-hidden="true" className="size-3" />,
    has: (r) => !!r.latency && (r.latency.minMs > 0 || r.latency.maxMs > 0),
    label: (r) => ({
      key: "mocks.routes.tooltipLatency",
      fallback: FALLBACKS.latency,
      values: { min: r.latency?.minMs ?? 0, max: r.latency?.maxMs ?? 0 },
    }),
  },
  {
    id: "failure",
    icon: <Zap aria-hidden="true" className="size-3" />,
    has: (r) => !!r.failure && r.failure.probability > 0,
    label: (r) => ({
      key: "mocks.routes.tooltipFailure",
      fallback: FALLBACKS.failure,
      values: {
        percent: Math.round((r.failure?.probability ?? 0) * 100),
        kind: r.failure?.kind ?? "status",
      },
    }),
  },
  {
    id: "stateful",
    icon: <Database aria-hidden="true" className="size-3" />,
    has: (r) => !!r.stateful?.enabled,
    label: () => ({ key: "mocks.routes.tooltipStateful", fallback: FALLBACKS.stateful }),
  },
  {
    id: "transform",
    icon: <Code aria-hidden="true" className="size-3" />,
    has: (r) => typeof r.transform === "string" && r.transform.length > 0,
    label: () => ({ key: "mocks.routes.tooltipTransform", fallback: FALLBACKS.transform }),
  },
  {
    id: "disabled",
    icon: <Ban aria-hidden="true" className="size-3" />,
    has: (r) => r.enabled === false,
    label: () => ({ key: "mocks.routes.tooltipDisabled", fallback: FALLBACKS.disabled }),
  },
  {
    id: "conditional",
    icon: <ArrowLeftRight aria-hidden="true" className="size-3" />,
    has: (r) => (r.responses ?? []).some((resp) => (resp.rules ?? []).length > 0),
    label: () => ({ key: "mocks.routes.tooltipConditional", fallback: FALLBACKS.conditional }),
  },
];

function routeTraits(route: MockRoute): RouteTraitDef[] {
  return ROUTE_TRAITS.filter((def) => def.has(route));
}

/** Icon-only summary badges with tooltips, shared by the route list and editor header. */
export function TraitIcons({ route }: { route: MockRoute }) {
  const { t } = useTranslation();
  const active = routeTraits(route);
  if (active.length === 0) return null;
  return (
    <>
      {active.map((def) => (
        <Tooltip key={def.id}>
          <TooltipTrigger asChild>
            <span className="flex items-center text-muted-foreground">{def.icon}</span>
          </TooltipTrigger>
          <TooltipContent side="top">
            {t(def.label(route).key, {
              defaultValue: def.label(route).fallback,
              ...(def.label(route).values ?? {}),
            })}
          </TooltipContent>
        </Tooltip>
      ))}
    </>
  );
}

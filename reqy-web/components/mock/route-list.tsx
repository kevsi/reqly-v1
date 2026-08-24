"use client";

import { useMemo, useState } from "react";
import { Clock, Code, Database, MoreVertical, Search, Trash2, Copy, Zap } from "lucide-react";
import type { MockRoute } from "@reqly/mock-engine";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { methodBadgeClass } from "./mock-utils";

const K = {
  title: "mocks.routes.title",
  search: "mocks.routes.search",
  searchPh: "mocks.routes.searchPlaceholder",
  duplicate: "mocks.routes.duplicate",
  remove: "mocks.routes.remove",
  deleteTitle: "mocks.routes.deleteTitle",
  deleteDesc: "mocks.routes.deleteDesc",
  empty: "mocks.routes.empty",
  noMatch: "mocks.routes.noMatch",
  tooltipLatency: "mocks.routes.tooltipLatency",
  tooltipFailure: "mocks.routes.tooltipFailure",
  tooltipStateful: "mocks.routes.tooltipStateful",
  tooltipTransform: "mocks.routes.tooltipTransform",
  ariaRoute: "mocks.routes.ariaSelect",
} as const;

interface RouteListProps {
  routes: MockRoute[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
}

export function RouteList({ routes, selectedId, onSelect, onDelete, onDuplicate }: RouteListProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return routes;
    return routes.filter(
      (route) => route.path.toLowerCase().includes(q) || route.method.toLowerCase().includes(q),
    );
  }, [routes, query]);

  const deleting = deletingId ? routes.find((r) => r.id === deletingId) : null;

  return (
    <div className="flex min-h-0 flex-col rounded-xl border bg-card lg:w-80 lg:shrink-0">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <p className="text-sm font-semibold">
          {t(K.title, { defaultValue: "Routes" })}
          <Badge variant="secondary" className="ml-2 font-mono text-[10px]">
            {routes.length}
          </Badge>
        </p>
      </div>
      <div className="border-b px-3 py-2">
        <div className="relative">
          <Search
            aria-hidden="true"
            className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t(K.searchPh, { defaultValue: "Filtrer les routes…" })}
            aria-label={t(K.search, { defaultValue: "Recherche" })}
            className="h-8 pl-7 text-xs"
          />
        </div>
      </div>
      <div className="max-h-[420px] min-h-24 flex-1 overflow-y-auto p-1.5 scrollbar-discreet lg:max-h-none">
        {routes.length === 0 ? (
          <p className="p-4 text-center text-xs text-muted-foreground">
            {t(K.empty, { defaultValue: "Aucune route pour le moment." })}
          </p>
        ) : filtered.length === 0 ? (
          <p className="p-4 text-center text-xs text-muted-foreground">
            {t(K.noMatch, { defaultValue: "Aucun résultat." })}
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {filtered.map((route) => {
              const isActive = route.id === selectedId;
              return (
                <li key={route.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelect(route.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelect(route.id);
                      }
                    }}
                    aria-label={
                      t(K.ariaRoute, { defaultValue: "Sélectionner la route" }) +
                      ` ${route.method} ${route.path}`
                    }
                    className={cn(
                      "group flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                      isActive ? "bg-primary/10" : "hover:bg-accent/50",
                    )}
                  >
                    <span
                      className={cn(
                        "shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold",
                        methodBadgeClass(String(route.method)),
                      )}
                    >
                      {String(route.method).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs" title={route.path}>
                      {route.path}
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
                      <Badge variant="outline" className="px-1 font-mono text-[10px]">
                        {(route.responses ?? []).length}
                      </Badge>
                      {route.latency && (route.latency.minMs > 0 || route.latency.maxMs > 0) && (
                        <SummaryIcon
                          icon={<Clock aria-hidden="true" className="size-3" />}
                          label={t(K.tooltipLatency, {
                            defaultValue: "Latence {{min}}–{{max}} ms",
                            min: route.latency.minMs,
                            max: route.latency.maxMs,
                          })}
                        />
                      )}
                      {route.failure && route.failure.probability > 0 && (
                        <SummaryIcon
                          icon={<Zap aria-hidden="true" className="size-3" />}
                          label={t(K.tooltipFailure, {
                            defaultValue: "Panne {{percent}} % · {{kind}}",
                            percent: Math.round(route.failure.probability * 100),
                            kind: route.failure.kind,
                          })}
                        />
                      )}
                      {route.stateful?.enabled && (
                        <SummaryIcon
                          icon={<Database aria-hidden="true" className="size-3" />}
                          label={t(K.tooltipStateful, { defaultValue: "Stateful" })}
                        />
                      )}
                      {route.transform && (
                        <SummaryIcon
                          icon={<Code aria-hidden="true" className="size-3" />}
                          label={t(K.tooltipTransform, { defaultValue: "Transform JS" })}
                        />
                      )}
                    </span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                          aria-label={t(K.title, { defaultValue: "Routes" }) + ` ${route.path}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreVertical aria-hidden="true" className="size-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenuItem onClick={() => onDuplicate(route.id)}>
                          <Copy aria-hidden="true" className="size-3.5" />
                          {t(K.duplicate, { defaultValue: "Dupliquer" })}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => setDeletingId(route.id)}
                        >
                          <Trash2 aria-hidden="true" className="size-3.5" />
                          {t(K.remove, { defaultValue: "Supprimer" })}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <ConfirmDialog
        open={deletingId !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingId(null);
        }}
        title={t(K.deleteTitle, { defaultValue: "Supprimer cette route ?" })}
        description={deleting ? `${String(deleting.method).toUpperCase()} ${deleting.path}` : ""}
        confirmLabel={t(K.remove, { defaultValue: "Supprimer" })}
        onConfirm={() => {
          if (deletingId) onDelete(deletingId);
          setDeletingId(null);
        }}
      />
    </div>
  );
}

function SummaryIcon({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex items-center">{icon}</span>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

"use client";

import { useMemo, useState } from "react";
import { Ban, Copy, MoreVertical, Power, PowerOff, Search, Trash2 } from "lucide-react";
import type { MockRoute } from "@reqly/mock-engine";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { methodBadgeClass, normalizeMethod } from "./mock-utils";
import { BulkActionsBar } from "./bulk-actions-bar";
import { RouteFilters } from "./route-filters";
import { ROUTE_TRAITS, TraitIcons, type RouteTrait } from "./trait-icons";

const K = {
  title: "mocks.routes.title",
  search: "mocks.routes.search",
  searchPh: "mocks.routes.searchPlaceholder",
  duplicate: "mocks.routes.duplicate",
  remove: "mocks.routes.remove",
  empty: "mocks.routes.empty",
  noMatch: "mocks.routes.noMatch",
  ariaRoute: "mocks.routes.ariaSelect",
  enableRoute: "mocks.routes.enableRoute",
  disableRoute: "mocks.routes.disableRoute",
  disabledBadge: "mocks.routes.disabledBadge",
  selectRoute: "mocks.routes.selectCheckbox",
} as const;

export interface RowClickMods {
  meta: boolean;
  shift: boolean;
}

interface RouteListProps {
  routes: MockRoute[];
  selectedId: string | null;
  /** Multi-selection state (owned by the page for bulk operations). */
  selectedIds: ReadonlySet<string>;
  onRowClick: (id: string, mods: RowClickMods) => void;
  onToggleSelected: (id: string) => void;
  onClearSelection: () => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  /** Bulk operations over the current selection (applied atomically by the page). */
  onDuplicateSelected: () => void;
  onSetEnabledSelected: (enabled: boolean) => void;
  onDeleteSelected: () => void;
}

export function RouteList({
  routes,
  selectedId,
  selectedIds,
  onRowClick,
  onToggleSelected,
  onClearSelection,
  onDelete,
  onDuplicate,
  onToggleEnabled,
  onDuplicateSelected,
  onSetEnabledSelected,
  onDeleteSelected,
}: RouteListProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [methods, setMethods] = useState<Set<string>>(new Set());
  const [traits, setTraits] = useState<Set<RouteTrait>>(new Set());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return routes.filter((route) => {
      if (methods.size > 0 && !methods.has(normalizeMethod(String(route.method)))) return false;
      if (traits.size > 0) {
        for (const trait of traits) {
          const def = ROUTE_TRAITS.find((d) => d.id === trait);
          if (!def || !def.has(route)) return false;
        }
      }
      if (!q) return true;
      return route.path.toLowerCase().includes(q) || route.method.toLowerCase().includes(q);
    });
  }, [routes, query, methods, traits]);

  const selectionCount = selectedIds.size;

  function toggleMethod(method: string) {
    setMethods((prev) => {
      const next = new Set(prev);
      if (next.has(method)) next.delete(method);
      else next.add(method);
      return next;
    });
  }

  function toggleTrait(trait: RouteTrait) {
    setTraits((prev) => {
      const next = new Set(prev);
      if (next.has(trait)) next.delete(trait);
      else next.add(trait);
      return next;
    });
  }

  function resetFilters() {
    setMethods(new Set());
    setTraits(new Set());
    setQuery("");
  }

  return (
    <div className="bg-card flex h-full min-h-0 flex-col overflow-hidden rounded-xl border">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <p className="flex items-center gap-2 text-sm font-semibold">
          {t(K.title, { defaultValue: "Routes" })}
          <Badge variant="secondary" className="font-mono text-[10px]">
            {routes.length}
          </Badge>
        </p>
        {selectionCount > 0 && (
          <Badge variant="outline" className="border-primary/40 text-primary font-mono text-[10px]">
            {selectionCount}
          </Badge>
        )}
      </div>

      {selectionCount > 0 && (
        <div className="border-b px-1.5 py-1.5">
          <BulkActionsBar
            count={selectionCount}
            onDuplicate={onDuplicateSelected}
            onSetEnabled={onSetEnabledSelected}
            onDelete={onDeleteSelected}
            onClear={onClearSelection}
          />
        </div>
      )}

      <div className="relative border-b px-3 py-2">
        <Search
          aria-hidden="true"
          className="text-muted-foreground absolute top-1/2 left-2 size-3.5 -translate-y-1/2"
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t(K.searchPh, { defaultValue: "Filtrer les routes…" })}
          aria-label={t(K.search, { defaultValue: "Recherche" })}
          className="h-8 pl-7 text-xs"
        />
      </div>

      <RouteFilters
        routes={routes}
        filteredCount={filtered.length}
        methods={methods}
        traits={traits}
        onToggleMethod={toggleMethod}
        onToggleTrait={toggleTrait}
        onReset={resetFilters}
      />

      <ul className="min-h-24 flex-1 overflow-y-auto p-1.5 scrollbar-discreet">
        {routes.length === 0 ? (
          <li>
            <p className="text-muted-foreground p-4 text-center text-xs">
              {t(K.empty, { defaultValue: "Aucune route pour le moment." })}
            </p>
          </li>
        ) : filtered.length === 0 ? (
          <li>
            <p className="text-muted-foreground p-4 text-center text-xs">
              {t(K.noMatch, { defaultValue: "Aucun résultat." })}
            </p>
          </li>
        ) : (
          filtered.map((route) => (
            <li key={route.id}>
              <RouteRow
                route={route}
                active={route.id === selectedId}
                checked={selectedIds.has(route.id)}
                showCheckbox={selectionCount > 0}
                label={t(K.ariaRoute, { defaultValue: "Sélectionner la route" })}
                selectLabel={t(K.selectRoute, { defaultValue: "Sélectionner" })}
                enableLabel={t(K.enableRoute, { defaultValue: "Activer la route" })}
                disableLabel={t(K.disableRoute, { defaultValue: "Désactiver la route" })}
                menuLabel={t(K.title, { defaultValue: "Routes" })}
                duplicateLabel={t(K.duplicate, { defaultValue: "Dupliquer" })}
                removeLabel={t(K.remove, { defaultValue: "Supprimer" })}
                disabledBadge={t(K.disabledBadge, { defaultValue: "Désactivée" })}
                onRowClick={(mods) => onRowClick(route.id, mods)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onRowClick(route.id, { meta: e.metaKey || e.ctrlKey, shift: e.shiftKey });
                  }
                }}
                onToggleSelected={() => onToggleSelected(route.id)}
                onDuplicate={() => onDuplicate(route.id)}
                onDelete={() => onDelete(route.id)}
                onToggleEnabled={(enabled) => onToggleEnabled(route.id, enabled)}
              />
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

interface RouteRowProps {
  route: MockRoute;
  active: boolean;
  checked: boolean;
  showCheckbox: boolean;
  label: string;
  selectLabel: string;
  enableLabel: string;
  disableLabel: string;
  menuLabel: string;
  duplicateLabel: string;
  removeLabel: string;
  disabledBadge: string;
  onRowClick: (mods: RowClickMods) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onToggleSelected: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onToggleEnabled: (enabled: boolean) => void;
}

function RouteRow({
  route,
  active,
  checked,
  showCheckbox,
  label,
  selectLabel,
  enableLabel,
  disableLabel,
  menuLabel,
  duplicateLabel,
  removeLabel,
  disabledBadge,
  onRowClick,
  onKeyDown,
  onToggleSelected,
  onDuplicate,
  onDelete,
  onToggleEnabled,
}: RouteRowProps) {
  const enabled = route.enabled !== false;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(e) => onRowClick({ meta: e.metaKey || e.ctrlKey, shift: e.shiftKey })}
      onKeyDown={onKeyDown}
      aria-label={`${label} ${String(route.method).toUpperCase()} ${route.path}`}
      aria-pressed={checked}
      className={cn(
        "group flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left transition-all duration-150 focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
        active ? "ring-primary bg-primary/10 ring-1" : "hover:bg-accent/50",
        !enabled && "opacity-50",
      )}
    >
      <span
        className={cn(
          "shrink-0 transition-opacity duration-150",
          checked || showCheckbox ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <Checkbox
          checked={checked}
          onCheckedChange={() => onToggleSelected()}
          aria-label={`${selectLabel} ${route.path}`}
          className="size-3.5"
        />
      </span>
      <span
        className={cn(
          "shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold",
          methodBadgeClass(String(route.method)),
        )}
      >
        {String(route.method).toUpperCase()}
      </span>
      {!enabled && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="text-muted-foreground"
              aria-label={disabledBadge}
            >
              <Ban aria-hidden="true" className="size-2.5" />
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">{disabledBadge}</TooltipContent>
        </Tooltip>
      )}
      <span className="min-w-0 flex-1 truncate font-mono text-xs" title={route.path}>
        {route.path}
      </span>
      <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
        <Badge variant="outline" className="px-1 font-mono text-[10px]">
          {(route.responses ?? []).length}
        </Badge>
        <TraitIcons route={route} />
      </span>
      <div className="flex shrink-0 items-center gap-0.5">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn(
          "size-7 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100",
          enabled
            ? "text-emerald-600 opacity-60 hover:text-emerald-600 hover:opacity-100"
            : "text-muted-foreground opacity-60 hover:text-muted-foreground hover:opacity-100",
        )}
        aria-label={enabled ? disableLabel : enableLabel}
        title={enabled ? disableLabel : enableLabel}
        onClick={(e) => {
          e.stopPropagation();
          onToggleEnabled(!enabled);
        }}
      >
        {enabled ? (
          <Power aria-hidden="true" className="size-3.5" />
        ) : (
          <PowerOff aria-hidden="true" className="size-3.5" />
        )}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
            aria-label={`${menuLabel} ${route.path}`}
            title={`${menuLabel} — ${route.path}`}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreVertical aria-hidden="true" className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem onClick={onDuplicate}>
            <Copy aria-hidden="true" className="size-3.5" />
            {duplicateLabel}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <Trash2 aria-hidden="true" className="size-3.5" />
            {removeLabel}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      </div>
    </div>
  );
}

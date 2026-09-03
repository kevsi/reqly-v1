"use client";

import { Search, X, CheckSquare, Square, SlidersHorizontal, Brain, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { HttpMethod } from "@/hooks/use-request-store";
import { methodBadge } from "@/lib/http-method-colors";
import { useTranslation } from "react-i18next";

interface SearchFilterBarProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  allSelected: boolean;
  onToggleSelectAll: () => void;
  showFilters: boolean;
  onToggleFilters: () => void;
  methodFilter: Set<HttpMethod>;
  onToggleMethodFilter: (method: HttpMethod) => void;
  sortBy: "name" | "updated" | "requests" | "manual";
  onSortChange: (sort: "name" | "updated" | "requests" | "manual") => void;
  semanticSearchEnabled: boolean;
  onToggleSemanticSearch: (enabled: boolean) => void;
}

export function SearchFilterBar({
  searchQuery,
  onSearchChange,
  allSelected,
  onToggleSelectAll,
  showFilters,
  onToggleFilters,
  methodFilter,
  onToggleMethodFilter,
  sortBy,
  onSortChange,
  semanticSearchEnabled,
  onToggleSemanticSearch,
}: SearchFilterBarProps) {
  const { t } = useTranslation();
  const activeFilters = methodFilter.size + (sortBy !== "name" ? 1 : 0);

  return (
    <div className="border-b border-border bg-card/50 px-3 py-2.5 shrink-0 space-y-2.5">
      {/* Row 1 — command palette style */}
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1 group">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50 pointer-events-none group-focus-within:text-primary transition-colors" />
          <Input
            placeholder={t("collections.searchBar.placeholder")}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-8 pl-8 pr-8 text-[13px] bg-background border-border focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 transition-colors placeholder:text-muted-foreground/50"
          />
          {searchQuery ? (
            <button
              onClick={() => onSearchChange("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 flex size-6 items-center justify-center rounded text-muted-foreground/40 hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Clear"
            >
              <X className="size-3.5" />
            </button>
          ) : (
            <span className="hidden sm:flex absolute right-1.5 top-1/2 -translate-y-1/2 items-center gap-0.5 rounded border border-border bg-muted px-1 py-0.5 text-[10px] font-mono text-muted-foreground/40 leading-none">
              /
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => onToggleSemanticSearch(!semanticSearchEnabled)}
          className={cn(
            "shrink-0 flex items-center gap-1.5 rounded-md border px-2.5 h-8 text-xs font-medium transition-colors",
            semanticSearchEnabled
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-background text-muted-foreground border-border hover:text-foreground hover:border-border hover:bg-muted/50",
          )}
          title={t("collections.searchBar.semanticTitle")}
        >
          <Brain className="size-3.5" />
          <span className="hidden sm:inline">{t("collections.searchBar.semanticLabel")}</span>
        </button>

        <div className="flex items-center gap-0.5 shrink-0 border-l border-border ml-0.5 pl-1.5">
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleSelectAll}
            className={cn("size-7", allSelected && "text-primary bg-primary/10")}
            title={allSelected ? t("collections.searchBar.deselectAll") : t("collections.searchBar.selectAll")}
          >
            {allSelected ? <CheckSquare className="size-4" /> : <Square className="size-4 text-muted-foreground/60" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleFilters}
            className={cn("size-7 relative", showFilters && "bg-muted text-foreground")}
            title={t("collections.searchBar.filtersTitle")}
          >
            <SlidersHorizontal className="size-4" />
            {activeFilters > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground leading-none">
                {activeFilters}
              </span>
            )}
          </Button>
        </div>
      </div>

      {/* Row 2 — method filters + sort (compact, premium) */}
      {showFilters && (
        <div className="flex items-start justify-between gap-3 pt-1 border-t border-border/50 -mx-3 px-3 -mb-1 pb-1">
          <div className="flex flex-wrap items-center gap-1">
            {(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as HttpMethod[]).map((method) => {
              const active = methodFilter.has(method);
              return (
                <button
                  key={method}
                  onClick={() => onToggleMethodFilter(method)}
                  className={cn(
                    "px-2 py-1 rounded text-[11px] font-bold leading-none border transition-colors",
                    active
                      ? `${methodBadge[method]} border-transparent`
                      : "bg-background text-muted-foreground border-border hover:text-foreground hover:border-foreground/20",
                  )}
                >
                  {method}
                </button>
              );
            })}
          </div>

          <label className="flex items-center gap-1.5 shrink-0 text-xs text-muted-foreground ml-auto">
            <ArrowUpDown className="size-3 text-muted-foreground/40" />
            <select
              value={sortBy}
              onChange={(e) => onSortChange(e.target.value as typeof sortBy)}
              className="h-6 rounded border border-transparent bg-transparent pl-1 pr-6 text-xs font-medium text-foreground hover:border-border hover:bg-background focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer"
            >
              <option value="name">{t("collections.searchBar.sortName")}</option>
              <option value="updated">{t("collections.searchBar.sortRecent")}</option>
              <option value="requests">{t("collections.searchBar.sortRequests")}</option>
              <option value="manual">{t("collections.searchBar.sortManual", { defaultValue: "Manuel" })}</option>
            </select>
          </label>
        </div>
      )}
    </div>
  );
}

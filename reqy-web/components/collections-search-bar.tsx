"use client";

import {
  Search,
  X,
  CheckSquare,
  Square,
  SlidersHorizontal,
  ArrowUpDown,
  Brain,
} from "lucide-react";
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
  return (
    <div className="border-b border-border/60 px-3 py-2 shrink-0 space-y-1.5">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/60 pointer-events-none" />
          <Input
            placeholder={t("collections.searchBar.placeholder")}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-9 pl-9 pr-9 text-sm bg-muted/30 border-border/50 focus-visible:bg-background transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-foreground transition-colors"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => onToggleSemanticSearch(!semanticSearchEnabled)}
          className={cn(
            "shrink-0 h-9 px-2.5 text-xs font-medium rounded-md border transition-colors flex items-center gap-1.5",
            semanticSearchEnabled
              ? "bg-primary/10 text-primary border-primary/30"
              : "text-muted-foreground/60 border-border/50 hover:text-foreground hover:border-border",
          )}
          title={t("collections.searchBar.semanticTitle")}
        >
          <Brain className="size-3.5" />
          {t("collections.searchBar.semanticLabel")}
        </button>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleSelectAll}
            className={cn("h-9 w-9 p-0", allSelected && "text-primary")}
            title={
              allSelected
                ? t("collections.searchBar.deselectAll")
                : t("collections.searchBar.selectAll")
            }
          >
            {allSelected ? <CheckSquare className="size-4.5" /> : <Square className="size-4.5" />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleFilters}
            className={cn(
              "h-9 w-9 p-0",
              (methodFilter.size > 0 || sortBy !== "name") && "text-primary",
            )}
            title={t("collections.searchBar.filtersTitle")}
          >
            <SlidersHorizontal className="size-4.5" />
          </Button>
        </div>
      </div>

      {showFilters && (
        <div className="flex items-center gap-3 pt-1.5 pb-0.5">
          <div className="flex items-center gap-1 flex-wrap">
            {(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as HttpMethod[]).map(
              (method) => {
                const active = methodFilter.has(method);
                return (
                  <button
                    key={method}
                    onClick={() => onToggleMethodFilter(method)}
                    className={cn(
                      "px-3 py-1 text-xs font-bold rounded-md border transition-colors",
                      active
                        ? `${methodBadge[method]} border-transparent`
                        : "text-muted-foreground/60 border-border/50 hover:border-border hover:text-foreground",
                    )}
                  >
                    {method}
                  </button>
                );
              },
            )}
          </div>
          <div className="ml-auto flex items-center gap-1">
            <ArrowUpDown className="size-3.5 text-muted-foreground/50" />
            <select
              value={sortBy}
              onChange={(e) => onSortChange(e.target.value as typeof sortBy)}
              className="h-7 text-xs bg-transparent border-0 text-muted-foreground/70 hover:text-foreground cursor-pointer outline-none font-medium"
            >
              <option value="name">{t("collections.searchBar.sortName")}</option>
              <option value="updated">{t("collections.searchBar.sortRecent")}</option>
              <option value="requests">{t("collections.searchBar.sortRequests")}</option>
              <option value="manual">{t("collections.searchBar.sortManual", { defaultValue: "Manuel" })}</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
}

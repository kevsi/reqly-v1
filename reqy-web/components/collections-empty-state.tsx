"use client";

import { Layers, Plus, SearchX, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";

interface EmptyStateProps {
  searchQuery: string;
  onCreateCollection: () => void;
}

export function CollectionsEmptyState({ searchQuery, onCreateCollection }: EmptyStateProps) {
  const { t } = useTranslation();
  const isSearch = !!searchQuery;

  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {/* Icon — premium, muted */}
      <div className="flex size-12 items-center justify-center rounded-lg bg-muted border border-border mb-4">
        {isSearch ? (
          <SearchX className="size-5 text-muted-foreground" />
        ) : (
          <Layers className="size-5 text-muted-foreground" />
        )}
      </div>

      <h3 className="text-sm font-semibold text-foreground tracking-tight">
        {isSearch ? t("collections.empty.noMatchTitle") : t("collections.empty.noCollectionsTitle")}
      </h3>
      <p className="mt-1.5 max-w-[28ch] text-xs leading-relaxed text-muted-foreground">
        {isSearch ? t("collections.empty.noMatchDescription") : t("collections.empty.noCollectionsDescription")}
      </p>

      {!isSearch && (
        <div className="mt-6 flex flex-col items-center gap-3">
          <Button
            size="sm"
            data-testid="new-collection-button"
            onClick={onCreateCollection}
            className="h-8 gap-1.5 px-3.5 text-xs font-medium"
          >
            <Plus className="size-3.5" />
            {t("collections.empty.createCollection")}
          </Button>
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground/60">
            <Sparkles className="size-3" />
            {t("collections.empty.hint", { defaultValue: "Organisez vos requêtes par domaine, API ou sprint" })}
          </span>
        </div>
      )}

      {/* Subtle helper when searching */}
      {isSearch && (
        <p className="mt-4 text-[11px] text-muted-foreground/50 font-mono">
          {t("collections.empty.tryDifferent", { defaultValue: "Essayez un autre terme ou effacez les filtres" })}
        </p>
      )}
    </div>
  );
}

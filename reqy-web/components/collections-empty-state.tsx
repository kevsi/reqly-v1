"use client";

import { Package, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useTranslation } from "react-i18next";

interface EmptyStateProps {
  searchQuery: string;
  onCreateCollection: () => void;
}

export function CollectionsEmptyState({ searchQuery, onCreateCollection }: EmptyStateProps) {
  const { t } = useTranslation();
  return (
    <Empty className="animate-fade-in">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Package />
        </EmptyMedia>
        <EmptyTitle>
          {searchQuery
            ? t("collections.empty.noMatchTitle")
            : t("collections.empty.noCollectionsTitle")}
        </EmptyTitle>
        <EmptyDescription>
          {searchQuery
            ? t("collections.empty.noMatchDescription")
            : t("collections.empty.noCollectionsDescription")}
        </EmptyDescription>
      </EmptyHeader>
      {!searchQuery && (
        <Button
          variant="default"
          size="sm"
          data-testid="new-collection-button"
          onClick={onCreateCollection}
          className="h-8 gap-1.5 text-xs font-medium shadow-xs"
        >
          <Plus />
          {t("collections.empty.createCollection")}
        </Button>
      )}
    </Empty>
  );
}

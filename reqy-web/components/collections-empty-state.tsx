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

interface EmptyStateProps {
  searchQuery: string;
  onCreateCollection: () => void;
}

export function CollectionsEmptyState({ searchQuery, onCreateCollection }: EmptyStateProps) {
  return (
    <Empty className="animate-fade-in">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Package />
        </EmptyMedia>
        <EmptyTitle>
          {searchQuery ? "No collections match your search" : "No collections yet"}
        </EmptyTitle>
        <EmptyDescription>
          {searchQuery
            ? "Try a different search term or clear the filter"
            : "Create a collection to organize your API requests"}
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
          Create Collection
        </Button>
      )}
    </Empty>
  );
}

"use client";

import { X, Download, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";

interface SelectionToolbarProps {
  selectedCollectionCount: number;
  selectedRequestCount: number;
  exporting: boolean;
  onClear: () => void;
  onBulkExport: () => void;
  onBulkDelete: () => void;
}

export function SelectionToolbar({
  selectedCollectionCount,
  selectedRequestCount,
  exporting,
  onClear,
  onBulkExport,
  onBulkDelete,
}: SelectionToolbarProps) {
  const { t } = useTranslation();
  if (selectedCollectionCount === 0 && selectedRequestCount === 0) return null;

  return (
    <div className="flex items-center justify-between border-b border-border/60 px-3 py-1.5 shrink-0 bg-gradient-to-r from-primary/8 to-primary/3 border-t-0 shadow-sm">
      <span className="text-sm font-medium text-foreground/70 flex items-center gap-1.5">
        <span className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
          {selectedCollectionCount + selectedRequestCount}
        </span>
        {selectedCollectionCount > 0 &&
          t("collections.selection.selectedCollections", { count: selectedCollectionCount })}
        {selectedCollectionCount > 0 && selectedRequestCount > 0 && t("collections.selection.plus")}
        {selectedRequestCount > 0 &&
          t("collections.selection.selectedRequests", { count: selectedRequestCount })}
        {t("collections.selection.suffix")}
      </span>
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          className="h-8 px-3 text-xs font-medium text-muted-foreground transition-all duration-150 hover:scale-105 active:scale-95 hover:text-foreground"
        >
          <X className="size-3.5 mr-1.5" />
          {t("collections.selection.clear")}
        </Button>
        <div className="w-px h-4 bg-border/40 mx-0.5" />
        <Button
          variant="ghost"
          size="sm"
          onClick={onBulkExport}
          disabled={exporting}
          className="h-8 px-3 text-xs font-medium text-muted-foreground transition-all duration-150 hover:scale-105 active:scale-95 hover:text-foreground"
        >
          {exporting ? (
            <Loader2 className="size-3.5 mr-1.5 animate-spin" />
          ) : (
            <Download className="size-3.5 mr-1.5" />
          )}
          {t("collections.selection.export")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onBulkDelete}
          className="h-8 px-3 text-xs font-medium text-destructive transition-all duration-150 hover:scale-105 active:scale-95 hover:text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="size-3.5 mr-1.5" />
          {t("collections.selection.delete")}
        </Button>
      </div>
    </div>
  );
}

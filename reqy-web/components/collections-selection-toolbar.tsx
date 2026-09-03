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

  const total = selectedCollectionCount + selectedRequestCount;

  return (
    <div className="sticky bottom-3 z-20 mx-3 mt-auto flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2 shadow-sm">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-[11px] font-bold text-primary-foreground tabular-nums">
          {total}
        </span>
        <span className="text-xs font-medium text-foreground truncate">
          {selectedCollectionCount > 0 &&
            t("collections.selection.selectedCollections", { count: selectedCollectionCount })}
          {selectedCollectionCount > 0 && selectedRequestCount > 0 && (
            <span className="text-muted-foreground mx-1">·</span>
          )}
          {selectedRequestCount > 0 &&
            t("collections.selection.selectedRequests", { count: selectedRequestCount })}
          <span className="text-muted-foreground font-normal ml-1.5">
            {t("collections.selection.suffix")}
          </span>
        </span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          className="h-7 px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="size-3.5" />
          {t("collections.selection.clear")}
        </Button>
        <span className="w-px h-4 bg-border mx-0.5" />
        <Button
          variant="ghost"
          size="sm"
          onClick={onBulkExport}
          disabled={exporting}
          className="h-7 px-2.5 text-xs font-medium transition-colors"
        >
          {exporting ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
          {t("collections.selection.export")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onBulkDelete}
          className="h-7 px-2.5 text-xs font-medium text-destructive hover:text-destructive hover:bg-destructive/10 transition-colors"
        >
          <Trash2 className="size-3.5" />
          {t("collections.selection.delete")}
        </Button>
      </div>
    </div>
  );
}

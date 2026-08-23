"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { SdkDownloadButton } from "@/components/sdk-download-button";
import type { Collection } from "@/hooks/use-request-store";
import { useTranslation } from "react-i18next";

interface HistoryLikeItem {
  requestId: string;
  responseBody?: unknown;
}

interface OpenApiExportModalProps {
  open: boolean;
  onClose: () => void;
  collections: Collection[];
  historyItems?: HistoryLikeItem[];
  onExport: (options: { inferFromHistory: boolean }) => Promise<void> | void;
}

export function OpenApiExportModal({
  open,
  onClose,
  collections,
  historyItems,
  onExport,
}: OpenApiExportModalProps) {
  const { t } = useTranslation();
  const [inferFromHistory, setInferFromHistory] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  const totalRequests = useMemo(
    () => collections.reduce((sum, c) => sum + c.requests.length, 0),
    [collections],
  );

  const hasInferableHistory = useMemo(() => {
    if (!historyItems || historyItems.length === 0) return false;
    return historyItems.some((h) => h.responseBody !== undefined && h.responseBody !== null);
  }, [historyItems]);

  const handleExportClick = async () => {
    setIsExporting(true);
    try {
      await onExport({ inferFromHistory: inferFromHistory && hasInferableHistory });
      onClose();
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] p-0 flex flex-col gap-0 overflow-hidden">
        <DialogHeader className="p-4 border-b shrink-0 bg-card">
          <DialogTitle>{t("importExport.openapiExport.title")}</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground mt-0.5">
            {t("importExport.openapiExport.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="rounded-lg border border-border bg-muted/30 px-3.5 py-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">{t("importExport.openapiExport.summary")}</p>
            <p className="mt-0.5">
              {t("importExport.openapiExport.summaryLine", {
                count: collections.length,
                total: totalRequests,
              })}
            </p>
          </div>

          <Field orientation="horizontal" className="rounded-md border border-border p-3">
            <Checkbox
              id="infer-from-history"
              checked={inferFromHistory}
              onCheckedChange={(c) => setInferFromHistory(!!c)}
              disabled={!hasInferableHistory}
            />
            <div className="flex-1">
              <FieldLabel htmlFor="infer-from-history" className="text-xs font-medium">
                {t("importExport.openapiExport.inferSchemas")}
              </FieldLabel>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {hasInferableHistory
                  ? t("importExport.openapiExport.inferHasHistory")
                  : t("importExport.openapiExport.inferNoHistory")}
              </p>
            </div>
          </Field>

          <div className="rounded-lg border border-dashed border-border p-3.5 space-y-2">
            <p className="text-xs font-semibold text-foreground">
              {t("importExport.openapiExport.sdkClient")}
            </p>
            <SdkDownloadButton
              collections={collections}
              historyItems={historyItems}
              inferFromHistory={inferFromHistory && hasInferableHistory}
              defaultName={collections.length === 1 ? collections[0].name : "reqly"}
            />
          </div>
        </div>

        <DialogFooter className="p-3 border-t bg-muted/20 shrink-0 flex flex-row items-center justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={onClose}
            disabled={isExporting}
            className="text-xs"
          >
            {t("common.cancel")}
          </Button>
          <Button
            size="sm"
            onClick={handleExportClick}
            disabled={isExporting || collections.length === 0}
            className="text-xs"
          >
            {isExporting ? (
              <>
                <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                {t("importExport.common.exporting")}
              </>
            ) : (
              t("common.export")
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

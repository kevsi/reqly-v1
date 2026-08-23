"use client";

import { useEffect, useState } from "react";
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
import { toast } from "@/hooks/use-toast";
import { Collection } from "@/hooks/use-request-store";
import { useTranslation } from "react-i18next";

interface ExportPostmanModalProps {
  open: boolean;
  onClose: () => void;
  collections: Collection[];
  onExport: (selectedCollectionIds: string[]) => Promise<void> | void;
  isConnected: boolean;
}

export function ExportPostmanModal({
  open,
  onClose,
  collections,
  onExport,
  isConnected,
}: ExportPostmanModalProps) {
  const { t } = useTranslation();
  const [selectedCollectionIds, setSelectedCollectionIds] = useState<string[]>([]);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    if (!open) return;
    const selectTimeout = window.setTimeout(
      () => setSelectedCollectionIds(collections.map((collection) => collection.id)),
      0,
    );
    return () => window.clearTimeout(selectTimeout);
  }, [open, collections]);

  const toggleCollection = (collectionId: string) => {
    setSelectedCollectionIds((current) =>
      current.includes(collectionId)
        ? current.filter((id) => id !== collectionId)
        : [...current, collectionId],
    );
  };

  const selectAll = () => {
    setSelectedCollectionIds(collections.map((collection) => collection.id));
  };

  const clearSelection = () => {
    setSelectedCollectionIds([]);
  };

  const selectedRequestCount = collections
    .filter((collection) => selectedCollectionIds.includes(collection.id))
    .reduce((sum, collection) => sum + collection.requests.length, 0);

  const handleExportClick = async () => {
    if (!selectedCollectionIds.length) {
      toast({
        title: t("importExport.postmanExport.selectAtLeastOne"),
        description: t("importExport.postmanExport.selectDesc"),
        variant: "destructive",
      });
      return;
    }

    setIsExporting(true);
    try {
      await onExport(selectedCollectionIds);
      onClose();
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] p-0 flex flex-col gap-0 overflow-hidden">
        <DialogHeader className="p-4 border-b shrink-0 bg-card">
          <DialogTitle>{t("importExport.postmanExport.title")}</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground mt-0.5">
            {t("importExport.postmanExport.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {!isConnected ? (
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground mb-4">
                {t("importExport.postmanExport.notConnected")}
              </p>
              <Button variant="secondary" onClick={onClose}>
                {t("common.close")}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">
                    {t("importExport.postmanExport.collectionsLabel")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("importExport.postmanExport.available", { count: collections.length })}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={selectAll}>
                    {t("importExport.postmanExport.selectAll")}
                  </Button>
                  <Button variant="outline" size="sm" onClick={clearSelection}>
                    {t("importExport.postmanExport.deselectAll")}
                  </Button>
                </div>
              </div>

              <div className="space-y-2 max-h-56 overflow-y-auto rounded-md border border-border bg-background px-3 py-2">
                {collections.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t("importExport.postmanExport.noCollections")}
                  </p>
                ) : (
                  collections.map((collection) => {
                    const checked = selectedCollectionIds.includes(collection.id);
                    return (
                      <label
                        key={collection.id}
                        className="flex cursor-pointer items-center gap-3 rounded-md border p-2.5 transition hover:bg-muted text-xs"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleCollection(collection.id)}
                        />
                        <div className="flex-1">
                          <p className="font-medium text-foreground">{collection.name}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {t("importExport.postmanExport.requestsCount", {
                              count: collection.requests.length,
                            })}
                          </p>
                        </div>
                      </label>
                    );
                  })
                )}
              </div>

              <div className="space-y-1.5 rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">
                  {t("importExport.postmanExport.confirmation")}
                </p>
                <p>
                  {t("importExport.postmanExport.exportingCollections", {
                    count: selectedCollectionIds.length,
                  })}
                </p>
                <p>
                  {t("importExport.postmanExport.exportingRequests", {
                    count: selectedRequestCount,
                  })}
                </p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="p-3 border-t bg-muted/20 shrink-0 flex flex-row items-center justify-between sm:justify-between">
          <div className="text-xs text-muted-foreground font-mono">
            {selectedCollectionIds.length} col. / {selectedRequestCount} req.
          </div>
          <div className="flex items-center gap-2">
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
              disabled={isExporting || selectedCollectionIds.length === 0}
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
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

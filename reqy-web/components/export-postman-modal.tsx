"use client";

import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-xl border bg-card p-6 shadow-lg">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-semibold">{t("importExport.postmanExport.title")}</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {t("importExport.postmanExport.description")}
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

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

            <div className="space-y-2 max-h-72 overflow-y-auto rounded-md border border-border bg-background px-3 py-2">
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
                      className="flex cursor-pointer items-center gap-3 rounded-md border p-3 transition hover:bg-muted"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleCollection(collection.id)}
                      />
                      <div className="flex-1">
                        <p className="font-medium">{collection.name}</p>
                        <p className="text-xs text-muted-foreground">
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

            <div className="space-y-2 rounded-lg border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
              <p className="font-medium">{t("importExport.postmanExport.confirmation")}</p>
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

            <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
              <p>
                {t("importExport.postmanExport.selectedCollections", {
                  count: selectedCollectionIds.length,
                })}
              </p>
              <p>
                {t("importExport.postmanExport.requestsTotal", { count: selectedRequestCount })}
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={onClose} disabled={isExporting}>
                {t("common.cancel")}
              </Button>
              <Button
                onClick={handleExportClick}
                disabled={isExporting || selectedCollectionIds.length === 0}
              >
                {isExporting ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" />
                    {t("importExport.common.exporting")}
                  </>
                ) : (
                  t("common.export")
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

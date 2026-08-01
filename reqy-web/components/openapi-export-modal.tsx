"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { SdkDownloadButton } from "@/components/sdk-download-button";
import type { Collection } from "@/hooks/use-request-store";

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

  useEffect(() => {
    if (!open) return;
    setIsExporting(false);
  }, [open]);

  const handleExportClick = async () => {
    setIsExporting(true);
    try {
      await onExport({ inferFromHistory: inferFromHistory && hasInferableHistory });
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
            <h2 className="text-lg font-semibold">Exporter en OpenAPI</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Génère un fichier OpenAPI 3.0 à partir de vos collections Reqly.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
            <p className="font-medium">Résumé</p>
            <p>
              <span className="font-semibold">{collections.length}</span> collection
              {collections.length === 1 ? "" : "s"} ·{" "}
              <span className="font-semibold">{totalRequests}</span> requête
              {totalRequests === 1 ? "" : "s"} au total.
            </p>
          </div>

          <Field orientation="horizontal" className="rounded-md border border-border px-3 py-2">
            <Checkbox
              id="infer-from-history"
              checked={inferFromHistory}
              onCheckedChange={(c) => setInferFromHistory(!!c)}
              disabled={!hasInferableHistory}
            />
            <div className="flex-1">
              <FieldLabel htmlFor="infer-from-history" className="text-xs">
                Infer schemas from history (merge with generic via allOf)
              </FieldLabel>
              <p className="text-[11px] text-muted-foreground mt-1">
                {hasInferableHistory
                  ? "Les schémas de réponse seront enrichis à partir du dernier historique disponible pour chaque requête."
                  : "Aucun historique disponible. Les schémas resteront génériques."}
              </p>
            </div>
          </Field>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={isExporting}>
              Annuler
            </Button>
            <Button onClick={handleExportClick} disabled={isExporting || collections.length === 0}>
              {isExporting ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Export en cours...
                </>
              ) : (
                "Exporter"
              )}
            </Button>
          </div>

          <div className="rounded-lg border border-dashed border-border px-4 py-3 space-y-2">
            <p className="text-xs font-medium">SDK client</p>
            <SdkDownloadButton
              collections={collections}
              historyItems={historyItems}
              inferFromHistory={inferFromHistory && hasInferableHistory}
              defaultName={collections.length === 1 ? collections[0].name : "reqly"}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

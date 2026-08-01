"use client";

import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import { Collection } from "@/hooks/use-request-store";

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
        title: "Sélectionnez au moins une collection",
        description: "Choisissez les collections Reqly à exporter vers Postman.",
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
            <h2 className="text-lg font-semibold">Exporter vers Postman</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Sélectionnez les collections Reqly à exporter, puis confirmez l’exportation vers
              Postman.
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        {!isConnected ? (
          <div className="text-center py-8">
            <p className="text-sm text-muted-foreground mb-4">
              Postman n'est pas connecté. Connectez-vous dans les paramètres pour activer l'export.
            </p>
            <Button variant="secondary" onClick={onClose}>
              Fermer
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">Collections Reqly</p>
                <p className="text-xs text-muted-foreground">
                  {collections.length} collection{collections.length === 1 ? "" : "s"} disponibles
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={selectAll}>
                  Tout sélectionner
                </Button>
                <Button variant="outline" size="sm" onClick={clearSelection}>
                  Tout désélectionner
                </Button>
              </div>
            </div>

            <div className="space-y-2 max-h-72 overflow-y-auto rounded-md border border-border bg-background px-3 py-2">
              {collections.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucune collection à exporter.</p>
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
                          {collection.requests.length} requête
                          {collection.requests.length === 1 ? "" : "s"}
                        </p>
                      </div>
                    </label>
                  );
                })
              )}
            </div>

            <div className="space-y-2 rounded-lg border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
              <p className="font-medium">Confirmation d'exportation</p>
              <p>
                Vous êtes sur le point d’exporter{" "}
                <span className="font-semibold">{selectedCollectionIds.length}</span> collection
                {selectedCollectionIds.length === 1 ? "" : "s"} vers Postman.
              </p>
              <p>
                Cela inclut <span className="font-semibold">{selectedRequestCount}</span> requête
                {selectedRequestCount === 1 ? "" : "s"} au total.
              </p>
            </div>

            <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
              <p>
                {selectedCollectionIds.length} collection
                {selectedCollectionIds.length === 1 ? "" : "s"} sélectionnée
                {selectedCollectionIds.length === 1 ? "" : "s"}.
              </p>
              <p>
                {selectedRequestCount} requête{selectedRequestCount === 1 ? "" : "s"} au total
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={onClose} disabled={isExporting}>
                Annuler
              </Button>
              <Button
                onClick={handleExportClick}
                disabled={isExporting || selectedCollectionIds.length === 0}
              >
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
          </div>
        )}
      </div>
    </div>
  );
}

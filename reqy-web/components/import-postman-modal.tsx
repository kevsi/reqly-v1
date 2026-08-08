"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { postmanImportResponseSchema } from "@/lib/import-schemas";
import { PostmanIcon } from "@/components/icons/postman";

interface ImportPostmanModalProps {
  open: boolean;
  onClose: () => void;
  onImport: (collection: { name: string; description?: string; routes: unknown[] }) => void;
  isConnected: boolean;
}

interface PostmanCollection {
  id: string;
  name: string;
  requests: number;
  items: number;
}

export function ImportPostmanModal({
  open,
  onClose,
  onImport,
  isConnected,
}: ImportPostmanModalProps) {
  const [collections, setCollections] = useState<PostmanCollection[]>([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string>("");
  const [isImporting, setIsImporting] = useState(false);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [collectionsError, setCollectionsError] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  const fetchCollections = useCallback(async () => {
    if (!isConnected) {
      setCollectionsError("Postman non connecté");
      return;
    }

    setCollectionsLoading(true);
    setCollectionsError(null);
    try {
      const response = await fetch("/api/postman-auth/collections", { credentials: "include" });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        setCollectionsError(error.message || "Impossible de charger les collections Postman");
        setCollections([]);
        return;
      }

      const data = await response.json();
      setCollections(data.collections || []);
    } catch {
      setCollectionsError("Impossible de charger les collections Postman");
      setCollections([]);
    } finally {
      setCollectionsLoading(false);
    }
  }, [isConnected]);

  useEffect(() => {
    if (!open || !isConnected) return;
    const fetchTimeout = window.setTimeout(() => fetchCollections(), 0);
    return () => window.clearTimeout(fetchTimeout);
  }, [open, isConnected, fetchCollections]);

  const handleImport = async () => {
    if (!selectedCollectionId) {
      toast({
        title: "Sélectionner une collection",
        description: "Choisissez une collection Postman à importer",
        variant: "destructive",
      });
      return;
    }

    setIsImporting(true);
    setImportStatus("Import de la collection...");

    try {
      const response = await fetch("/api/postman-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          collectionId: selectedCollectionId,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || "Erreur lors de l'import de la collection");
      }

      const data = await response.json();
      const validated = postmanImportResponseSchema.safeParse(data);
      if (!validated.success) {
        throw new Error("Réponse Postman invalide");
      }

      onImport({
        name: validated.data.name || "Postman Collection",
        description: validated.data.metadata?.description || "",
        routes: validated.data.routes || [],
      });

      toast({
        title: `Collection "${data.name || "Postman Collection"}" importée`,
        description: `${(data.routes || []).length} routes importées`,
        meta: { event: "importExport" },
      });
      onClose();
      setSelectedCollectionId("");
      setImportStatus(null);
    } catch (err) {
      toast({
        title: "Erreur",
        description: err instanceof Error ? err.message : "Erreur lors de l'import",
        variant: "destructive",
        meta: { event: "importExport" },
      });
    } finally {
      setIsImporting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-xl border bg-card p-6 shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <PostmanIcon className="size-10 rounded-full bg-white p-1" aria-hidden="true" />
            <h2 className="text-lg font-semibold">Importer depuis Postman</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        {!isConnected ? (
          <div className="text-center py-8">
            <p className="text-sm text-muted-foreground mb-4">
              Postman n'est pas connecté. Connectez-vous dans les paramètres d'abord.
            </p>
            <Button onClick={onClose} variant="secondary">
              Fermer
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Sélectionner une collection</label>
              {collectionsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : collectionsError ? (
                <p className="text-sm text-destructive">{collectionsError}</p>
              ) : collections.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucune collection trouvée</p>
              ) : (
                <Select value={selectedCollectionId} onValueChange={setSelectedCollectionId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Choisir une collection..." />
                  </SelectTrigger>
                  <SelectContent>
                    {collections.map((col) => (
                      <SelectItem key={col.id} value={col.id}>
                        <div>
                          <p className="font-medium">{col.name}</p>
                          <p className="text-xs text-muted-foreground">{col.items} éléments</p>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {importStatus && (
              <div className="rounded-lg bg-blue-50 p-3 dark:bg-blue-950/40">
                <p className="text-sm text-blue-900 dark:text-blue-200">{importStatus}</p>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                onClick={handleImport}
                disabled={isImporting || !selectedCollectionId}
                className="flex-1"
              >
                {isImporting ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" />
                    Import en cours...
                  </>
                ) : (
                  "Importer"
                )}
              </Button>
              <Button
                onClick={onClose}
                variant="secondary"
                className="flex-1"
                disabled={isImporting}
              >
                Annuler
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

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
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
  const [collections, setCollections] = useState<PostmanCollection[]>([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string>("");
  const [isImporting, setIsImporting] = useState(false);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [collectionsError, setCollectionsError] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  const fetchCollections = useCallback(async () => {
    if (!isConnected) {
      setCollectionsError(t("importExport.postman.notConnectedShort"));
      return;
    }

    setCollectionsLoading(true);
    setCollectionsError(null);
    try {
      const response = await fetch("/api/postman-auth/collections", { credentials: "include" });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        setCollectionsError(error.message || t("importExport.postman.loadError"));
        setCollections([]);
        return;
      }

      const data = await response.json();
      setCollections(data.collections || []);
    } catch {
      setCollectionsError(t("importExport.postman.loadError"));
      setCollections([]);
    } finally {
      setCollectionsLoading(false);
    }
  }, [isConnected, t]);

  useEffect(() => {
    if (!open || !isConnected) return;
    const fetchTimeout = window.setTimeout(() => fetchCollections(), 0);
    return () => window.clearTimeout(fetchTimeout);
  }, [open, isConnected, fetchCollections]);

  const handleImport = async () => {
    if (!selectedCollectionId) {
      toast({
        title: t("importExport.postman.selectCollectionToast"),
        description: t("importExport.postman.selectCollectionDesc"),
        variant: "destructive",
      });
      return;
    }

    setIsImporting(true);
    setImportStatus(t("importExport.postman.importingCollection"));

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
        throw new Error(error.message || t("importExport.postman.importError"));
      }

      const data = await response.json();
      const validated = postmanImportResponseSchema.safeParse(data);
      if (!validated.success) {
        throw new Error(t("importExport.postman.invalidResponse"));
      }

      onImport({
        name: validated.data.name || "Postman Collection",
        description: validated.data.metadata?.description || "",
        routes: validated.data.routes || [],
      });

      toast({
        title: t("importExport.postman.importedTitle", {
          name: data.name || "Postman Collection",
        }),
        description: t("importExport.postman.routesImported", {
          count: (data.routes || []).length,
        }),
        meta: { event: "importExport" },
      });
      onClose();
      setSelectedCollectionId("");
      setImportStatus(null);
    } catch (err) {
      toast({
        title: t("common.error"),
        description: err instanceof Error ? err.message : t("importExport.common.importError"),
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
            <h2 className="text-lg font-semibold">{t("importExport.postman.importTitle")}</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        {!isConnected ? (
          <div className="text-center py-8">
            <p className="text-sm text-muted-foreground mb-4">
              {t("importExport.postman.notConnectedLong")}
            </p>
            <Button onClick={onClose} variant="secondary">
              {t("common.close")}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">
                {t("importExport.postman.selectCollectionToast")}
              </label>
              {collectionsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : collectionsError ? (
                <p className="text-sm text-destructive">{collectionsError}</p>
              ) : collections.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("importExport.postman.noCollections")}
                </p>
              ) : (
                <Select value={selectedCollectionId} onValueChange={setSelectedCollectionId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("importExport.postman.choosePlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {collections.map((col) => (
                      <SelectItem key={col.id} value={col.id}>
                        <div>
                          <p className="font-medium">{col.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {t("importExport.postman.itemsCount", { count: col.items })}
                          </p>
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
                    {t("importExport.common.importing")}
                  </>
                ) : (
                  t("common.import")
                )}
              </Button>
              <Button
                onClick={onClose}
                variant="secondary"
                className="flex-1"
                disabled={isImporting}
              >
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

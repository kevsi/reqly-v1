"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useRequestStore } from "@/hooks/use-request-store";
import { useShallow } from "zustand/react/shallow";
import { useTranslation } from "react-i18next";

interface ExtractedFolder {
  id: string;
  name: string;
  parentId: string | null;
}

interface ExtractedRequest {
  id: string;
  name: string;
  method: string;
  url: string;
  endpoint: string;
  headers: Record<string, string>;
  body: string;
  bodyType?: "json" | "form-data" | "x-www-form" | "raw" | "binary";
  queryParams: Array<{ key: string; value: string }>;
  folderId: string | null;
  authType: "none" | "bearer" | "basic" | "api-key" | "oauth2";
  authToken?: string;
  createdAt: string;
  updatedAt: string;
}

interface PostmanImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collectionId: string | null;
  collectionName: string;
  onImported?: (collectionId: string) => void;
}

const METHOD_COLORS: Record<string, string> = {
  GET: "bg-success/10 text-success",
  POST: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  PUT: "bg-warning/10 text-warning",
  PATCH: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  DELETE: "bg-destructive/10 text-destructive",
};

const PREVIEW_LIMIT = 3;

export function PostmanImportModal({
  open,
  onOpenChange,
  collectionId,
  collectionName,
  onImported,
}: PostmanImportModalProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [requests, setRequests] = useState<ExtractedRequest[]>([]);
  const [folders, setFolders] = useState<ExtractedFolder[]>([]);
  const [collectionIdReturned, setCollectionIdReturned] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Atomic + useShallow ÔÇö we only need two actions; no need to subscribe to
  // the entire store (and the `as any` cast is no longer required).
  const { addCollection, addRequestToCollection, addFolder } = useRequestStore(
    useShallow((s) => ({
      addCollection: s.addCollection,
      addRequestToCollection: s.addRequestToCollection,
      addFolder: s.addFolder,
    })),
  );

  useEffect(() => {
    if (!open || !collectionId) {
      const timer = window.setTimeout(() => {
        setRequests([]);
        setFolders([]);
        setCollectionIdReturned("");
        setError(null);
      }, 0);
      return () => window.clearTimeout(timer);
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
      fetch("/api/postman-import/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ collectionId }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (cancelled) return;
          if (!data.requests) {
            setError(data.message ?? t("importExport.postman.invalidResponse"));
            return;
          }
          // Store ALL requests ÔÇö preview only shows PREVIEW_LIMIT of them.
          setRequests(data.requests);
          setFolders(data.folders ?? []);
          setCollectionIdReturned(data.collectionId ?? collectionId);
        })
        .catch(() => {
          if (!cancelled) setError(t("importExport.common.networkError"));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, collectionId, t]);

  function handleConfirm() {
    if (requests.length === 0 || saving) return;
    setSaving(true);
    try {
      const newCollectionId = addCollection({
        name: collectionName,
        color: "emerald",
        icon: "package",
      });

      // Folders are emitted in DFS pre-order (parents before children) by
      // lib/postman-collection.ts. Walk them in order and remap each server
      // folderId to the freshly generated client one.
      const folderIdMap = new Map<string, string>();
      for (const folder of folders as ExtractedFolder[]) {
        const parentClientId = folder.parentId ? (folderIdMap.get(folder.parentId) ?? null) : null;
        const clientId: string = addFolder(newCollectionId, folder.name, parentClientId);
        folderIdMap.set(folder.id, clientId);
      }

      // Now create every request, remapping its folderId through the map.
      for (const req of requests) {
        const clientFolderId = req.folderId ? (folderIdMap.get(req.folderId) ?? null) : null;
        addRequestToCollection(newCollectionId, {
          name: req.name,
          method: req.method as never,
          url: req.url,
          endpoint: req.endpoint,
          headers: req.headers,
          body: req.body,
          ...(req.bodyType ? { bodyType: req.bodyType } : {}),
          queryParams: req.queryParams,
          folderId: clientFolderId,
          authType: req.authType,
          ...(req.authToken ? { authToken: req.authToken } : {}),
        });
      }

      toast({
        title: t("importExport.postman.imported"),
        description:
          t("importExport.postman.routesAdded", { count: requests.length }) +
          (folders.length > 0
            ? t("importExport.postman.foldersCount", { count: folders.length })
            : ""),
        meta: { event: "importExport" },
      });
      onImported?.(newCollectionId);
      onOpenChange(false);
    } catch (e) {
      toast({
        title: t("common.error"),
        description: e instanceof Error ? e.message : t("importExport.common.importFailed"),
        variant: "destructive",
        meta: { event: "importExport" },
      });
    } finally {
      setSaving(false);
    }
  }

  const previewRequests = requests.slice(0, PREVIEW_LIMIT);
  const hiddenCount = Math.max(0, requests.length - previewRequests.length);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("importExport.postman.importTitleWithName", { name: collectionName })}
          </DialogTitle>
          <DialogDescription>
            {loading
              ? t("importExport.postman.loadingPreview")
              : error
                ? error
                : requests.length > 0
                  ? t("importExport.postman.previewCount", {
                      count: requests.length,
                      preview: PREVIEW_LIMIT,
                    })
                  : t("importExport.postman.noRoutesToImport")}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-8 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : previewRequests.length > 0 ? (
          <div className="space-y-1">
            {previewRequests.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-2 rounded border bg-muted/20 p-2 text-sm"
              >
                <Badge variant="secondary" className={`shrink-0 ${METHOD_COLORS[r.method] ?? ""}`}>
                  {r.method}
                </Badge>
                <code className="min-w-0 flex-1 truncate font-mono text-xs">{r.url}</code>
              </div>
            ))}
            {hiddenCount > 0 && (
              <p className="pt-1 text-center text-xs text-muted-foreground">
                {t("importExport.postman.andMore", { count: hiddenCount })}
              </p>
            )}
            <p className="pt-1 text-center text-xs text-muted-foreground">
              {t("importExport.postman.collectionId")}{" "}
              <span className="font-mono">{collectionIdReturned}</span>
            </p>
          </div>
        ) : null}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleConfirm} disabled={loading || saving || requests.length === 0}>
            {saving
              ? t("importExport.postman.importingShort")
              : t("importExport.postman.confirmImport") +
                (requests.length > 0 ? ` (${requests.length})` : "")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

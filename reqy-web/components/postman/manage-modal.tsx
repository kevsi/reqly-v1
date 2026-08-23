"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";

interface Collection {
  id: string;
  name: string;
  requests: number;
  items: number;
}

interface PostmanManageModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userEmail?: string;
  isConnected: boolean;
  onSelectCollection: (collection: Collection) => void;
  onGoToSettings?: () => void;
}

export function PostmanManageModal({
  open,
  onOpenChange,
  userEmail,
  isConnected,
  onSelectCollection,
  onGoToSettings,
}: PostmanManageModalProps) {
  useToast();
  const { t } = useTranslation();

  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchedForOpenRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchCollections = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/postman-auth/collections", {
        credentials: "include",
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message ?? t("importExport.common.loadError"));
        return;
      }
      setCollections(data.collections ?? []);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(t("importExport.common.networkError"));
    } finally {
      if (abortRef.current === controller) {
        setLoading(false);
        abortRef.current = null;
      }
    }
  }, [t]);

  useEffect(() => {
    if (open && isConnected && !fetchedForOpenRef.current) {
      fetchedForOpenRef.current = true;
      void fetchCollections();
    } else if (!open) {
      fetchedForOpenRef.current = false;
      abortRef.current?.abort();
      abortRef.current = null;
    }
    return () => {
      abortRef.current?.abort();
    };
  }, [open, isConnected, fetchCollections]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] p-0 flex flex-col gap-0 overflow-hidden">
        <DialogHeader className="p-4 border-b shrink-0 bg-card">
          <DialogTitle className="flex items-center justify-between gap-3 text-base">
            <span>{t("importExport.postman.importTitle")}</span>
            {userEmail && (
              <span className="truncate text-xs font-normal text-muted-foreground font-mono">
                {userEmail}
              </span>
            )}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground mt-0.5">
            {!isConnected
              ? t("importExport.postman.notConnectedShort")
              : collections.length > 0
                ? t("importExport.postman.collectionCount", { count: collections.length })
                : t("importExport.postman.loadingCollections")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-4 min-h-[220px]">
          {!isConnected ? (
            <div className="rounded-lg border border-warning/30 bg-warning/10 p-4 text-xs">
              <p className="mb-3 text-warning font-medium">
                {t("importExport.postman.connectForImport")}
              </p>
              {onGoToSettings && (
                <Button size="sm" variant="outline" onClick={onGoToSettings} className="text-xs">
                  {t("importExport.postman.goToSettings")}
                </Button>
              )}
            </div>
          ) : loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />
              ))}
            </div>
          ) : error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-xs">
              <p className="text-destructive font-medium">{error}</p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3 text-xs"
                onClick={fetchCollections}
              >
                {t("common.retry")}
              </Button>
            </div>
          ) : collections.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              {t("importExport.postman.noCollectionsAccount")}
            </p>
          ) : (
            <div className="space-y-2">
              {collections.map((col) => (
                <Card
                  key={col.id}
                  className="flex flex-row items-center justify-between gap-3 p-3 text-xs border shadow-2xs"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="truncate font-medium text-foreground">{col.name}</span>
                    <span className="shrink-0 text-muted-foreground font-mono text-[11px]">
                      · {t("importExport.postmanExport.requestsCount", { count: col.requests })}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 text-xs h-7 px-2.5"
                    onClick={() => onSelectCollection(col)}
                  >
                    {t("common.import")}
                  </Button>
                </Card>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="p-3 border-t bg-muted/20 shrink-0 flex flex-row items-center justify-end">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="text-xs"
          >
            {t("common.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
  const { toast } = useToast();
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
        setError(data.message ?? "Erreur de chargement");
        return;
      }
      setCollections(data.collections ?? []);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError("Erreur réseau");
    } finally {
      if (abortRef.current === controller) {
        setLoading(false);
        abortRef.current = null;
      }
    }
  }, []);

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
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-3">
            <span>Importer depuis Postman</span>
            {userEmail && (
              <span className="truncate text-xs font-normal text-muted-foreground">
                {userEmail}
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            {!isConnected
              ? "Postman n'est pas connecté."
              : collections.length > 0
                ? `${collections.length} collection${collections.length > 1 ? "s" : ""} trouvée${collections.length > 1 ? "s" : ""} dans votre compte Postman.`
                : "Chargement des collections…"}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-[200px]">
          {!isConnected ? (
            <div className="rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm">
              <p className="mb-3 text-warning">
                Connectez-vous à Postman dans les paramètres pour importer vos collections.
              </p>
              {onGoToSettings && (
                <Button size="sm" variant="outline" onClick={onGoToSettings}>
                  Aller aux paramètres
                </Button>
              )}
            </div>
          ) : loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
              ))}
            </div>
          ) : error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
              <p className="text-destructive">{error}</p>
              <Button size="sm" variant="outline" className="mt-2" onClick={fetchCollections}>
                Réessayer
              </Button>
            </div>
          ) : collections.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Aucune collection dans votre compte Postman.
            </p>
          ) : (
            <div className="max-h-[400px] space-y-2 overflow-y-auto pr-1">
              {collections.map((col) => (
                <Card key={col.id} className="flex-row items-center justify-between gap-3 p-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="truncate text-sm font-medium">{col.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      ┬À {col.requests} requ├¬te{col.requests > 1 ? "s" : ""}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => onSelectCollection(col)}
                  >
                    Importer
                  </Button>
                </Card>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Fermer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

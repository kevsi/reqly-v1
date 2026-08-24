"use client";

import { useMemo, useState } from "react";
import { FolderOpen, Layers } from "lucide-react";
import { useRequestStore } from "@/hooks/use-request-store";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

const K = {
  title: "mocks.generate.title",
  description: "mocks.generate.description",
  requestsCount: "mocks.generate.requestsCount",
  empty: "mocks.generate.empty",
  cancel: "common.cancel",
  confirm: "mocks.generate.confirm",
} as const;

interface CollectionsGenerateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (collectionIds: string[]) => void;
}

export function CollectionsGenerateModal({
  open,
  onOpenChange,
  onConfirm,
}: CollectionsGenerateModalProps) {
  const { t } = useTranslation();
  const collections = useRequestStore((s) => s.collections);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const sorted = useMemo(
    () => [...collections].sort((a, b) => a.name.localeCompare(b.name)),
    [collections],
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setSelected(new Set());
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t(K.title, { defaultValue: "Générer depuis une collection" })}</DialogTitle>
          <DialogDescription>
            {t(K.description, {
              defaultValue:
                "Chaque requête sélectionnée devient une route avec une réponse squelette à affiner.",
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-80 overflow-y-auto rounded-md border p-1.5">
          {sorted.length === 0 ? (
            <p className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
              <FolderOpen aria-hidden="true" className="size-4" />
              {t(K.empty, { defaultValue: "Aucune collection disponible." })}
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {sorted.map((collection) => (
                <li key={collection.id}>
                  <label
                    className={cn(
                      "flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/50",
                      selected.has(collection.id) && "bg-primary/10",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(collection.id)}
                      onChange={() => toggle(collection.id)}
                      className="accent-primary"
                      aria-label={collection.name}
                    />
                    <span
                      aria-hidden="true"
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: collection.color }}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm">{collection.name}</span>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {(collection.requests ?? []).length}
                    </Badge>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {t(K.requestsCount, {
            defaultValue: "{{count}} requête(s) seront converties.",
            count: [...selected].reduce<number>((total, id) => {
              const col = collections.find((c) => c.id === id);
              return total + (col?.requests?.length ?? 0);
            }, 0),
          })}
        </p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t(K.cancel, { defaultValue: "Annuler" })}
          </Button>
          <Button
            type="button"
            disabled={selected.size === 0}
            onClick={() => {
              onConfirm([...selected]);
              setSelected(new Set());
              onOpenChange(false);
            }}
          >
            <Layers aria-hidden="true" className="size-4" />
            {t(K.confirm, { defaultValue: "Générer" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

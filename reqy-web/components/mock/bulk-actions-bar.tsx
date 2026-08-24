"use client";

import { Copy, Power, PowerOff, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";

const K = {
  selected: "mocks.bulk.selected",
  duplicate: "mocks.bulk.duplicate",
  enable: "mocks.bulk.enable",
  disable: "mocks.bulk.disable",
  remove: "mocks.bulk.remove",
  clear: "mocks.bulk.clearSelection",
} as const;

interface BulkActionsBarProps {
  count: number;
  onDuplicate: () => void;
  onSetEnabled: (enabled: boolean) => void;
  onDelete: () => void;
  onClear: () => void;
}

export function BulkActionsBar({
  count,
  onDuplicate,
  onSetEnabled,
  onDelete,
  onClear,
}: BulkActionsBarProps) {
  const { t } = useTranslation();
  return (
    <div className="bg-background/95 sticky top-0 z-20 flex items-center gap-1 rounded-lg border px-2 py-1.5 shadow-sm backdrop-blur">
      <span
        className="mr-1 text-xs font-medium whitespace-nowrap"
        role="status"
        aria-live="polite"
      >
        {t(K.selected, { defaultValue: "{{count}} sélectionnée(s)", count })}
      </span>
      <span className="bg-border mr-1 h-4 w-px" aria-hidden="true" />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7"
        onClick={onDuplicate}
        aria-label={t(K.duplicate, { defaultValue: "Dupliquer" })}
        title={t(K.duplicate, { defaultValue: "Dupliquer" })}
      >
        <Copy aria-hidden="true" className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 text-emerald-600 hover:text-emerald-600"
        onClick={() => onSetEnabled(true)}
        aria-label={t(K.enable, { defaultValue: "Activer" })}
        title={t(K.enable, { defaultValue: "Activer" })}
      >
        <Power aria-hidden="true" className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 text-muted-foreground hover:text-muted-foreground"
        onClick={() => onSetEnabled(false)}
        aria-label={t(K.disable, { defaultValue: "Désactiver" })}
        title={t(K.disable, { defaultValue: "Désactiver" })}
      >
        <PowerOff aria-hidden="true" className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="text-destructive hover:text-destructive size-7"
        onClick={onDelete}
        aria-label={t(K.remove, { defaultValue: "Supprimer" })}
        title={t(K.remove, { defaultValue: "Supprimer" })}
      >
        <Trash2 aria-hidden="true" className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="ml-auto size-7 text-muted-foreground"
        onClick={onClear}
        aria-label={t(K.clear, { defaultValue: "Annuler la sélection" })}
        title={t(K.clear, { defaultValue: "Annuler la sélection" })}
      >
        <X aria-hidden="true" className="size-3.5" />
      </Button>
    </div>
  );
}

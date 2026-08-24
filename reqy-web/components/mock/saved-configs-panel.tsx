"use client";

import { useMemo } from "react";
import { Download, FileDown, Trash2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import type { MockConfig } from "@reqly/mock-engine";
import type { SavedMockConfig } from "./saved-configs";

const K = {
  title: "mocks.saved.title",
  empty: "mocks.saved.empty",
  saveCurrent: "mocks.saved.saveCurrent",
  load: "mocks.saved.load",
  download: "mocks.saved.download",
  remove: "mocks.saved.remove",
  sourceAi: "mocks.saved.sourceAi",
  sourceDraft: "mocks.saved.sourceDraft",
  sourceImport: "mocks.saved.sourceImport",
} as const;

interface SavedConfigsPanelProps {
  configs: SavedMockConfig[];
  className?: string;
  onSaveCurrentDraft?: () => void;
  canSaveCurrentDraft?: boolean;
  onLoad: (config: MockConfig) => void;
  onDownload: (entry: SavedMockConfig) => void;
  onRemove: (id: string) => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Panneau latéral « Gestion des configs » : historique téléchargeable des configs de mock. */
export function SavedConfigsPanel({
  configs,
  className,
  onSaveCurrentDraft,
  canSaveCurrentDraft = false,
  onLoad,
  onDownload,
  onRemove,
}: SavedConfigsPanelProps) {
  const { t } = useTranslation();

  const sourceLabel = useMemo(
    () => ({
      ai: t(K.sourceAi, { defaultValue: "IA" }),
      draft: t(K.sourceDraft, { defaultValue: "Brouillon" }),
      import: t(K.sourceImport, { defaultValue: "Import" }),
    }),
    [t],
  );

  return (
    <aside
      className={cn("bg-card/40 flex min-h-0 flex-col overflow-hidden rounded-xl border", className)}
      aria-label={t(K.title, { defaultValue: "Gestion des configs" })}
    >
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Download aria-hidden="true" className="size-3.5" />
          {t(K.title, { defaultValue: "Gestion des configs" })}
          <Badge variant="secondary" className="font-mono text-[10px]">
            {configs.length}
          </Badge>
        </p>
        {onSaveCurrentDraft && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                disabled={!canSaveCurrentDraft}
                onClick={onSaveCurrentDraft}
              >
                <Upload aria-hidden="true" className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t(K.saveCurrent, { defaultValue: "Sauvegarder le brouillon actuel" })}</TooltipContent>
          </Tooltip>
        )}
      </div>

      <ul className="min-h-16 flex-1 overflow-y-auto p-1.5 scrollbar-discreet">
        {configs.length === 0 ? (
          <li>
            <p className="text-muted-foreground p-4 text-center text-xs">
              {t(K.empty, {
                defaultValue:
                  "Aucune config enregistrée. Les configs générées par l'IA apparaîtront ici.",
              })}
            </p>
          </li>
        ) : (
          configs.map((entry) => (
            <li
              key={entry.id}
              className="group hover:bg-accent/40 rounded-md px-2 py-1.5 transition-colors"
            >
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium" title={entry.name}>
                    {entry.name}
                  </p>
                  <p className="text-muted-foreground flex items-center gap-1.5 text-[10px]">
                    <span>{formatDate(entry.createdAt)}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono">{entry.config.routes.length} routes</span>
                    {entry.config.port != null && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono">:{entry.config.port}</span>
                      </>
                    )}
                    <Badge variant="outline" className="px-1 py-0 text-[9px] uppercase">
                      {sourceLabel[entry.source] ?? entry.source}
                    </Badge>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-0.5 opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    onClick={() => onLoad(entry.config)}
                    aria-label={t(K.load, { defaultValue: "Charger dans le brouillon" })}
                    title={t(K.load, { defaultValue: "Charger dans le brouillon" })}
                  >
                    <Upload aria-hidden="true" className="size-3" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    onClick={() => onDownload(entry)}
                    aria-label={t(K.download, { defaultValue: "Télécharger" })}
                    title={t(K.download, { defaultValue: "Télécharger" })}
                  >
                    <FileDown aria-hidden="true" className="size-3" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="hover:text-destructive text-destructive size-6"
                    onClick={() => onRemove(entry.id)}
                    aria-label={t(K.remove, { defaultValue: "Supprimer" })}
                    title={t(K.remove, { defaultValue: "Supprimer" })}
                  >
                    <Trash2 aria-hidden="true" className="size-3" />
                  </Button>
                </div>
              </div>
            </li>
          ))
        )}
      </ul>
    </aside>
  );
}

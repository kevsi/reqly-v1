"use client";

import { useRef } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  FileDown,
  FileUp,
  FolderInput,
  Layers,
  Plus,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

const K = {
  pageTitle: "mocks.pageTitle",
  draftSaved: "mocks.editor.draftSaved",
  newRoute: "mocks.actions.newRoute",
  generate: "mocks.actions.generate",
  fileMenu: "mocks.actions.fileMenu",
  importJson: "mocks.actions.importJson",
  exportJson: "mocks.actions.exportJson",
  copyCmd: "mocks.actions.copyCmd",
  apply: "mocks.actions.apply",
  applyDirty: "mocks.actions.applyDirty",
  applyTooltipOffline: "mocks.actions.applyTooltipOffline",
  applyTooltipDirty: "mocks.actions.applyTooltipDirty",
  simpleMode: "mocks.simple.toggle",
} as const;

interface PageToolbarProps {
  className?: string;
  draftSavedAt: string | null;
  canExport: boolean;
  canApply: boolean;
  /** Le brouillon diffère de la dernière config appliquée au mock. */
  applyDirty?: boolean;
  /** Mode simple IA (vue générative à la place du tri-pane avancé). */
  simpleMode?: boolean;
  onSimpleModeChange?: (next: boolean) => void;
  onNewRoute: () => void;
  onGenerate: () => void;
  onImportFile: (file: File) => void;
  onExport: () => void | null;
  onCopyCmd: () => void;
  onApply: () => void;
}

export function PageToolbar({
  className,
  draftSavedAt,
  canExport,
  canApply,
  applyDirty = false,
  simpleMode = false,
  onSimpleModeChange,
  onNewRoute,
  onGenerate,
  onImportFile,
  onExport,
  onCopyCmd,
  onApply,
}: PageToolbarProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Raison affichée dans le tooltip du bouton Appliquer (désactivé ou modif. en attente).
  const applyTooltip = !canApply
    ? t(K.applyTooltipOffline, {
        defaultValue:
          "Connecte-toi à un mock en cours (`recli mock start`) pour appliquer ta config.",
      })
    : applyDirty
      ? t(K.applyTooltipDirty, {
          defaultValue: "Des modifications du brouillon ne sont pas encore appliquées au mock.",
        })
      : undefined;

  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-2", className)}>
      <div>
        <h1 className="text-lg font-semibold">
          {t(K.pageTitle, { defaultValue: "Mock Server" })}
        </h1>
        {draftSavedAt && (
          <p className="text-muted-foreground flex items-center gap-1 text-[11px]">
            <Check aria-hidden="true" className="size-3" />
            {t(K.draftSaved, {
              defaultValue: "Brouillon sauvegardé à {{time}}",
              time: draftSavedAt,
            })}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {onSimpleModeChange && (
          <label className="mr-1 flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <Switch
              checked={simpleMode}
              onCheckedChange={onSimpleModeChange}
              aria-label={t(K.simpleMode, { defaultValue: "Mode simple IA" })}
            />
            <span className={cn(simpleMode && "text-primary font-medium")}>
              {t(K.simpleMode, { defaultValue: "Mode simple IA" })}
            </span>
          </label>
        )}
        {!simpleMode && (
          <Button type="button" size="sm" className="h-8 text-xs" onClick={onNewRoute}>
            <Plus aria-hidden="true" className="size-3.5" />
            {t(K.newRoute, { defaultValue: "Nouvelle route" })}
          </Button>
        )}
        {!simpleMode && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={onGenerate}
          >
            <Layers aria-hidden="true" className="size-3.5" />
            {t(K.generate, { defaultValue: "Générer depuis collection" })}
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="h-8 text-xs">
              <FolderInput aria-hidden="true" className="size-3.5" />
              {t(K.fileMenu, { defaultValue: "Fichier" })}
              <ChevronDown aria-hidden="true" className="size-3 opacity-70" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
              <FileUp aria-hidden="true" className="size-3.5" />
              {t(K.importJson, { defaultValue: "Importer JSON" })}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!canExport} onClick={onExport}>
              <FileDown aria-hidden="true" className="size-3.5" />
              {t(K.exportJson, { defaultValue: "Exporter .json" })}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={onCopyCmd}>
          <Copy aria-hidden="true" className="size-3.5" />
          {t(K.copyCmd, { defaultValue: "Copier commande CLI" })}
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={canApply ? undefined : -1} className="inline-flex">
              <Button
                type="button"
                size="sm"
                className="h-8 text-xs"
                disabled={!canApply}
                onClick={onApply}
              >
                <Upload aria-hidden="true" className="size-3.5" />
                {t(K.apply, { defaultValue: "Appliquer au mock" })}
                {applyDirty && (
                  <Badge
                    variant="outline"
                    className="border-warning/40 bg-warning/10 text-warning ml-1 gap-1 px-1 py-0 text-[9px] font-medium"
                  >
                    <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
                    {t(K.applyDirty, { defaultValue: "non appliqué" })}
                  </Badge>
                )}
              </Button>
            </span>
          </TooltipTrigger>
          {applyTooltip && <TooltipContent side="bottom">{applyTooltip}</TooltipContent>}
        </Tooltip>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.yaml,.yml,application/json,text/yaml,application/x-yaml"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onImportFile(file);
            e.target.value = "";
          }}
          aria-label={t(K.importJson, { defaultValue: "Importer JSON" })}
        />
      </div>
    </div>
  );
}

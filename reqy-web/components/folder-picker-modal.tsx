"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen, HardDrive, Cpu, ShieldAlert, ArrowLeft, Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import {
  canPickFolder,
  pickFolder,
  pickFolderImport,
  pickVirtualFolder,
  type PickedFolder,
} from "@/lib/folder-picker";
import { isTauriAvailable } from "@/lib/tauri";

interface FolderPickerModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (folder: PickedFolder) => void;
  title?: string;
}

export function FolderPickerModal({ open, onClose, onSelect, title }: FolderPickerModalProps) {
  const { t } = useTranslation();
  const [virtualName, setVirtualName] = useState("");
  // Sur Tauri Desktop, on propose aussi l'option "browse" via OS
  const isTauri = isTauriAvailable();
  const [selectedMethod, setSelectedMethod] = useState<"browse" | "virtual">(
    isTauri ? "browse" : "virtual",
  );
  const [confirmStep, setConfirmStep] = useState(false);
  const [loading, setLoading] = useState(false);

  const resetState = () => {
    setConfirmStep(false);
    setLoading(false);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleStartBrowse = () => {
    if (isTauriAvailable()) {
      // Sur Tauri Desktop, dialogue système direct sans avertissement web
      executeBrowse();
    } else {
      // Sur le Web, passe par l'écran de confirmation personnalisé
      setConfirmStep(true);
    }
  };

  const executeBrowse = async () => {
    setLoading(true);
    try {
      let picked: PickedFolder | null = null;
      if (canPickFolder()) {
        picked = await pickFolder();
      } else {
        picked = await pickFolderImport();
      }
      if (picked) {
        onSelect(picked);
        handleClose();
      }
    } finally {
      setLoading(false);
    }
  };

  const executeVirtual = async () => {
    if (!virtualName.trim()) return;
    setLoading(true);
    try {
      const picked = await pickVirtualFolder(virtualName.trim());
      if (picked) {
        onSelect(picked);
        handleClose();
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            {confirmStep ? (
              <Button
                variant="ghost"
                size="sm"
                className="size-7 p-0 -ml-2 text-muted-foreground hover:text-foreground"
                onClick={() => setConfirmStep(false)}
              >
                <ArrowLeft className="size-4" />
              </Button>
            ) : (
              <FolderOpen className="size-4 text-primary" />
            )}
            {confirmStep
              ? "Confirmation d'importation de dossier"
              : title || t("git.selectFolderModalTitle", "Ouvrir ou créer un répertoire de projet")}
          </DialogTitle>
        </DialogHeader>

        {confirmStep ? (
          /* Écran de confirmation qui transforme l'avertissement du navigateur */
          <div className="space-y-4 pt-1">
            <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-amber-600 dark:text-amber-400">
              <ShieldAlert className="size-5 shrink-0 mt-0.5" />
              <div className="space-y-1 text-xs">
                <p className="font-semibold text-sm leading-tight text-foreground">
                  Importer les fichiers du dossier sur ce site ?
                </p>
                <p className="text-muted-foreground leading-relaxed">
                  Tous les fichiers du répertoire que vous allez choisir seront parcourus et
                  importés localement dans l'application pour vos opérations Git et collections.
                </p>
                <p className="text-[11px] font-medium text-amber-700 dark:text-amber-300 pt-1">
                  N'effectuez cette opération que s'il s'agit d'un répertoire de confiance. Le
                  navigateur affichera ensuite la fenêtre de choix du dossier.
                </p>
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmStep(false)}
                className="text-xs"
              >
                Annuler
              </Button>
              <Button
                size="sm"
                onClick={executeBrowse}
                disabled={loading}
                className="text-xs gap-1.5 bg-primary"
              >
                {loading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <FolderOpen className="size-3.5" />
                )}
                Confirmer & Parcourir le dossier
              </Button>
            </DialogFooter>
          </div>
        ) : (
          /* Écran de choix principal */
          <div className="space-y-3 pt-1">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Choisissez comment vous souhaitez ouvrir ou créer le répertoire de votre projet :
            </p>

            <div className="space-y-2">
              {/* Option Parcourir le disque — Desktop Tauri uniquement */}
              {isTauri && (
                <Card
                  className={`flex items-start gap-3 p-3.5 cursor-pointer transition-colors border ${
                    selectedMethod === "browse"
                      ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                      : "border-border/50 hover:bg-accent/40"
                  }`}
                  onClick={() => setSelectedMethod("browse")}
                >
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary mt-0.5">
                    <HardDrive className="size-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-foreground">
                        Parcourir et sélectionner un dossier
                      </p>
                      {selectedMethod === "browse" && <Check className="size-3.5 text-primary" />}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-normal">
                      Ouvre l'explorateur de votre ordinateur pour choisir un répertoire existant.
                    </p>
                  </div>
                </Card>
              )}

              {/* Option Dossier virtuel OPFS — toujours visible sur Web */}
              <Card
                className={`flex items-start gap-3 p-3.5 cursor-pointer transition-colors border ${
                  selectedMethod === "virtual"
                    ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                    : "border-border/50 hover:bg-accent/40"
                }`}
                onClick={() => setSelectedMethod("virtual")}
              >
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-purple-500/10 text-purple-500 mt-0.5">
                  <Cpu className="size-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-foreground">
                      Créer un dossier local (OPFS)
                    </p>
                    {selectedMethod === "virtual" && <Check className="size-3.5 text-primary" />}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-normal">
                    Crée un nouveau répertoire localisé dans le navigateur avec un nom sur-mesure.
                  </p>
                  {selectedMethod === "virtual" && (
                    <Input
                      value={virtualName}
                      onChange={(e) => setVirtualName(e.target.value)}
                      placeholder="Nom du projet (ex: mon-depot)"
                      className="mt-2.5 text-xs h-8"
                      autoFocus
                    />
                  )}
                </div>
              </Card>
            </div>

            <DialogFooter className="pt-2">
              <Button variant="ghost" size="sm" onClick={handleClose} className="text-xs">
                Annuler
              </Button>
              {selectedMethod === "browse" ? (
                <Button size="sm" onClick={handleStartBrowse} className="text-xs gap-1.5">
                  <FolderOpen className="size-3.5" />
                  Parcourir...
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={executeVirtual}
                  disabled={loading || !virtualName.trim()}
                  className="text-xs gap-1.5"
                >
                  {loading ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <FolderOpen className="size-3.5" />
                  )}
                  Créer le dossier
                </Button>
              )}
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

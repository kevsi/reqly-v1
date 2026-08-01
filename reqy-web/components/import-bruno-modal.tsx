"use client";

import { useState, useRef, useCallback } from "react";
import { Upload, FileText, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { parseBrunoCollection, convertBrunoToCollections } from "@/lib/bruno-import";
import type { CollectionImportData } from "@/lib/openapi-import";

interface ImportBrunoModalProps {
  open: boolean;
  onClose: () => void;
  onImport: (collections: CollectionImportData[]) => void;
}

type Step = "upload" | "preview" | "importing" | "done";

export function ImportBrunoModal({ open, onClose, onImport }: ImportBrunoModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("upload");
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parseResult, setParseResult] = useState<{
    collectionName: string;
    count: number;
  } | null>(null);
  const [rawContents, setRawContents] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");

  const reset = useCallback(() => {
    setStep("upload");
    setError(null);
    setParseResult(null);
    setRawContents("");
    setFileName("");
  }, []);

  const handleClose = () => {
    reset();
    onClose();
  };

  const processFile = useCallback((file: File) => {
    setError(null);
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (evt) => {
      const contents = evt.target?.result as string;
      if (!contents) {
        setError("Impossible de lire le fichier.");
        return;
      }

      const result = parseBrunoCollection(contents, file.name);
      if (!result.success) {
        setError(result.error);
        return;
      }

      setRawContents(contents);
      setParseResult({
        collectionName: result.collectionName,
        count: result.endpoints.length,
      });
      setStep("preview");
    };
    reader.onerror = () => {
      setError("Erreur lors de la lecture du fichier.");
    };
    reader.readAsText(file);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
      e.target.value = "";
    },
    [processFile],
  );

  const handleImport = () => {
    if (!parseResult || !rawContents || !fileName) return;
    setStep("importing");

    const result = parseBrunoCollection(rawContents, fileName);
    if (!result.success) {
      setError(result.error);
      setStep("preview");
      return;
    }

    const collections = convertBrunoToCollections(result);
    onImport(collections);
    setStep("done");

    setTimeout(() => {
      handleClose();
    }, 1500);
  };

  const handleBack = () => {
    setStep("upload");
    setParseResult(null);
    setError(null);
  };

  // ─── Upload step ─────────────────────────────────────────────────────────

  if (step === "upload") {
    return (
      <Dialog open={open} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Importer une collection Bruno</DialogTitle>
            <DialogDescription>
              Importez un fichier <strong>.bru</strong> ou un bundle JSON Bruno pour créer une
              collection Reqly.
            </DialogDescription>
          </DialogHeader>

          <div
            className={cn(
              "relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 transition-colors",
              dragging
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/25 hover:border-muted-foreground/50",
              error ? "border-destructive/50" : "",
            )}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".bru,.json"
              className="hidden"
              onChange={handleFileSelect}
            />

            {error ? (
              <div className="flex flex-col items-center gap-3 text-destructive">
                <AlertCircle className="h-10 w-10" />
                <p className="text-sm font-medium text-center">{error}</p>
                <Button variant="outline" size="sm" onClick={() => setError(null)}>
                  Réessayer
                </Button>
              </div>
            ) : (
              <>
                <Upload className="mb-4 h-10 w-10 text-muted-foreground" />
                <p className="mb-2 text-sm font-medium">Glissez-déposez votre fichier ici</p>
                <p className="mb-4 text-xs text-muted-foreground">ou</p>
                <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
                  Sélectionner un fichier
                </Button>
                <p className="mt-3 text-xs text-muted-foreground">
                  Formats supportés : <strong>.bru</strong> (Bruno DSL), <strong>.json</strong>{" "}
                  (bundle Bruno)
                </p>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ─── Preview step ────────────────────────────────────────────────────────

  if (step === "preview" && parseResult) {
    return (
      <Dialog open={open} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              {parseResult.collectionName}
            </DialogTitle>
            <DialogDescription>Collection Bruno prête à être importée.</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3 py-4">
            <div className="rounded-lg border bg-card p-3 text-center">
              <p className="text-2xl font-bold text-primary">{parseResult.count}</p>
              <p className="text-xs text-muted-foreground">
                Requête{parseResult.count > 1 ? "s" : ""}
              </p>
            </div>
            <div className="rounded-lg border bg-card p-3 text-center">
              <p className="text-2xl font-bold">1</p>
              <p className="text-xs text-muted-foreground">Collection</p>
            </div>
          </div>

          <DialogFooter className="flex items-center justify-between">
            <Button variant="ghost" onClick={handleBack}>
              Changer de fichier
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleClose}>
                Annuler
              </Button>
              <Button onClick={handleImport}>
                Importer{" "}
                {parseResult.count > 0
                  ? `${parseResult.count} requête${parseResult.count > 1 ? "s" : ""}`
                  : ""}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // ─── Importing step ──────────────────────────────────────────────────────

  if (step === "importing") {
    return (
      <Dialog open={open} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Import en cours...</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="mt-4 text-sm text-muted-foreground">
              Création de la collection et des requêtes...
            </p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ─── Done step ────────────────────────────────────────────────────────────

  if (step === "done") {
    return (
      <Dialog open={open} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Import terminé</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center justify-center py-8">
            <CheckCircle2 className="h-8 w-8 text-success" />
            <p className="mt-4 text-sm font-medium">
              {parseResult?.count || 0} requête{parseResult?.count !== 1 ? "s" : ""} importée
              {parseResult?.count !== 1 ? "s" : ""} avec succès.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return null;
}

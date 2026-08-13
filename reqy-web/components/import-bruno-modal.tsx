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
import { Trans, useTranslation } from "react-i18next";

interface ImportBrunoModalProps {
  open: boolean;
  onClose: () => void;
  onImport: (collections: CollectionImportData[]) => void;
}

type Step = "upload" | "preview" | "importing" | "done";

export function ImportBrunoModal({ open, onClose, onImport }: ImportBrunoModalProps) {
  const { t } = useTranslation();
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

  const processFile = useCallback(
    (file: File) => {
      setError(null);
      setFileName(file.name);

      const reader = new FileReader();
      reader.onload = (evt) => {
        const contents = evt.target?.result as string;
        if (!contents) {
          setError(t("importExport.common.readFileError"));
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
        setError(t("importExport.common.readError"));
      };
      reader.readAsText(file);
    },
    [t],
  );

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
            <DialogTitle>{t("importExport.bruno.title")}</DialogTitle>
            <DialogDescription>
              <Trans
                i18nKey="importExport.bruno.description"
                t={t}
                components={[<strong key="bru" />]}
              />
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
                  {t("common.retry")}
                </Button>
              </div>
            ) : (
              <>
                <Upload className="mb-4 h-10 w-10 text-muted-foreground" />
                <p className="mb-2 text-sm font-medium">{t("importExport.common.dragDrop")}</p>
                <p className="mb-4 text-xs text-muted-foreground">{t("importExport.common.or")}</p>
                <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
                  {t("importExport.common.selectFile")}
                </Button>
                <p className="mt-3 text-xs text-muted-foreground">
                  <Trans
                    i18nKey="importExport.bruno.formats"
                    t={t}
                    components={[<strong key="a" />, <strong key="b" />]}
                  />
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
            <DialogDescription>{t("importExport.bruno.ready")}</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3 py-4">
            <div className="rounded-lg border bg-card p-3 text-center">
              <p className="text-2xl font-bold text-primary">{parseResult.count}</p>
              <p className="text-xs text-muted-foreground">
                {t("importExport.bruno.requests", { count: parseResult.count })}
              </p>
            </div>
            <div className="rounded-lg border bg-card p-3 text-center">
              <p className="text-2xl font-bold">1</p>
              <p className="text-xs text-muted-foreground">{t("importExport.bruno.collection")}</p>
            </div>
          </div>

          <DialogFooter className="flex items-center justify-between">
            <Button variant="ghost" onClick={handleBack}>
              {t("importExport.common.switchFile")}
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleClose}>
                {t("common.cancel")}
              </Button>
              <Button onClick={handleImport}>
                {t("importExport.bruno.importRequests", { count: parseResult.count })}
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
            <DialogTitle>{t("importExport.common.importing")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="mt-4 text-sm text-muted-foreground">{t("importExport.bruno.creating")}</p>
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
            <DialogTitle>{t("importExport.common.doneTitle")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center justify-center py-8">
            <CheckCircle2 className="h-8 w-8 text-success" />
            <p className="mt-4 text-sm font-medium">
              {t("importExport.bruno.doneSummary", { count: parseResult?.count || 0 })}
            </p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return null;
}

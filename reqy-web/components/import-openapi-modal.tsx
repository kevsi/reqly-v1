"use client";

import { useState, useRef, useCallback } from "react";
import {
  Upload,
  FileText,
  AlertCircle,
  CheckCircle2,
  Loader2,
  ChevronRight,
  Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  parseOpenApiSpec,
  convertToCollections,
  type OpenApiParseSuccess,
  type CollectionImportData,
} from "@/lib/openapi-import";
import { useTranslation } from "react-i18next";

interface ImportOpenApiModalProps {
  open: boolean;
  onClose: () => void;
  onImport: (collections: CollectionImportData[]) => void;
  existingCollectionNames: string[];
}

type Step = "upload" | "preview" | "importing" | "done";

export function ImportOpenApiModal({
  open,
  onClose,
  onImport,
  existingCollectionNames,
}: ImportOpenApiModalProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("upload");
  const [dragging, setDragging] = useState(false);
  const [parseResult, setParseResult] = useState<OpenApiParseSuccess | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [_fileName, setFileName] = useState<string>("");
  const [_rawContents, setRawContents] = useState<string>("");

  // Options
  const [baseUrlOverride, setBaseUrlOverride] = useState("");
  const [groupByTag, setGroupByTag] = useState(true);
  const [showOptions, setShowOptions] = useState(false);

  const reset = useCallback(() => {
    setStep("upload");
    setParseResult(null);
    setError(null);
    setFileName("");
    setRawContents("");
    setBaseUrlOverride("");
    setGroupByTag(true);
    setShowOptions(false);
  }, []);

  const handleClose = () => {
    reset();
    onClose();
  };

  const processFile = useCallback(
    (file: File) => {
      setFileName(file.name);
      setError(null);

      const reader = new FileReader();
      reader.onload = (evt) => {
        const contents = evt.target?.result as string;
        if (!contents) {
          setError(t("importExport.common.readFileError"));
          return;
        }
        setRawContents(contents);

        const result = parseOpenApiSpec(contents, file.name);
        if (!result.success) {
          setError(result.error);
          return;
        }

        setParseResult(result);
        setBaseUrlOverride(result.spec.baseUrl || "");
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
      // Reset input value so the same file can be selected again
      e.target.value = "";
    },
    [processFile],
  );

  const handleImport = () => {
    if (!parseResult) return;

    setStep("importing");

    // Simulate async to let UI update
    setTimeout(() => {
      try {
        const collections = convertToCollections(parseResult, {
          baseUrlOverride: baseUrlOverride || undefined,
          groupByTag,
        });

        onImport(collections);
        setStep("done");

        setTimeout(() => {
          handleClose();
        }, 1500);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("importExport.common.importError"));
        setStep("preview");
      }
    }, 100);
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
            <DialogTitle>{t("importExport.openapi.title")}</DialogTitle>
            <DialogDescription>{t("importExport.openapi.description")}</DialogDescription>
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
              accept=".json,.yaml,.yml"
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
                  {t("importExport.openapi.formats")}
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
    const { spec, tagGroups, totalEndpoints } = parseResult;

    return (
      <Dialog open={open} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              {spec.title}{" "}
              <span className="text-sm font-normal text-muted-foreground">v{spec.version}</span>
            </DialogTitle>
            <DialogDescription>
              {spec.description ||
                t("importExport.openapi.endpointsDetected", { count: totalEndpoints })}
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="flex-1 pr-4">
            {/* Summary */}
            <div className="mb-4 grid grid-cols-3 gap-3">
              <div className="rounded-lg border bg-card p-3 text-center">
                <p className="text-2xl font-bold text-primary">{totalEndpoints}</p>
                <p className="text-xs text-muted-foreground">
                  {t("importExport.common.endpoints")}
                </p>
              </div>
              <div className="rounded-lg border bg-card p-3 text-center">
                <p className="text-2xl font-bold">{tagGroups.length}</p>
                <p className="text-xs text-muted-foreground">
                  {t("importExport.common.collections")}
                </p>
              </div>
              <div className="rounded-lg border bg-card p-3 text-center min-w-0">
                <p
                  className="text-xs font-mono font-semibold text-foreground truncate"
                  title={spec.baseUrl}
                >
                  {spec.baseUrl || "—"}
                </p>
                <p className="text-xs text-muted-foreground">{t("importExport.common.baseUrl")}</p>
              </div>
            </div>

            {/* Options */}
            <div className="mb-4">
              <button
                onClick={() => setShowOptions(!showOptions)}
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <Settings2 className="h-3.5 w-3.5" />
                {t("importExport.common.options")}
                <ChevronRight
                  className={cn("h-3.5 w-3.5 transition-transform", showOptions && "rotate-90")}
                />
              </button>

              {showOptions && (
                <div className="mt-2 rounded-lg border bg-card/50 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="group-by-tag" className="text-sm">
                      {t("importExport.common.groupByTag")}
                    </Label>
                    <Switch
                      id="group-by-tag"
                      checked={groupByTag}
                      onCheckedChange={setGroupByTag}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="base-url" className="text-sm">
                      {t("importExport.common.baseUrlOverride")}
                    </Label>
                    <Input
                      id="base-url"
                      placeholder={spec.baseUrl || "https://api.example.com"}
                      value={baseUrlOverride}
                      onChange={(e) => setBaseUrlOverride(e.target.value)}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Tag groups preview */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-muted-foreground">
                {t("importExport.common.collectionsPreview")}
              </h4>
              {tagGroups.map((group) => {
                const color = endpointColors[group.tag.length % endpointColors.length];
                const isNew = !existingCollectionNames.some(
                  (name) => name.toLowerCase() === group.collectionName.toLowerCase(),
                );
                return (
                  <div key={group.tag} className="rounded-lg border bg-card">
                    <div className="flex items-center justify-between border-b px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className={`h-2 w-2 rounded-full ${color}`} />
                        <span className="text-sm font-medium">{group.collectionName}</span>
                        <Badge
                          variant={isNew ? "default" : "secondary"}
                          className="text-[10px] px-1.5 py-0"
                        >
                          {isNew ? t("importExport.common.new") : t("importExport.common.exists")}
                        </Badge>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {t("importExport.openapi.endpointsGroup", {
                          count: group.endpoints.length,
                        })}
                      </span>
                    </div>
                    <div className="divide-y">
                      {group.endpoints.slice(0, 5).map((ep, i) => (
                        <div key={i} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                          <span
                            className={cn(
                              "font-mono font-semibold px-1.5 py-0.5 rounded text-[10px]",
                              methodColor(ep.method),
                            )}
                          >
                            {ep.method}
                          </span>
                          <span className="font-mono text-muted-foreground truncate">
                            {ep.path}
                          </span>
                        </div>
                      ))}
                      {group.endpoints.length > 5 && (
                        <p className="px-3 py-1.5 text-xs text-muted-foreground">
                          {t("importExport.common.more", { count: group.endpoints.length - 5 })}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>

          <DialogFooter className="mt-4 flex items-center justify-between border-t pt-4">
            <Button variant="ghost" onClick={handleBack}>
              {t("importExport.common.switchFile")}
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleClose}>
                {t("common.cancel")}
              </Button>
              <Button onClick={handleImport}>
                {t("importExport.openapi.importEndpoints", { count: totalEndpoints })}
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
            <p className="mt-4 text-sm text-muted-foreground">
              {t("importExport.openapi.creating")}
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
            <DialogTitle>{t("importExport.common.doneTitle")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center justify-center py-8">
            <CheckCircle2 className="h-8 w-8 text-success" />
            <p className="mt-4 text-sm font-medium">
              {t("importExport.openapi.doneSummary", { count: parseResult?.totalEndpoints || 0 })}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {t("importExport.openapi.doneCollections", {
                count: parseResult?.tagGroups.length || 0,
              })}
            </p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

const endpointColors = [
  "bg-success",
  "bg-blue-500",
  "bg-warning",
  "bg-purple-500",
  "bg-destructive",
  "bg-pink-500",
];

function methodColor(method: string): string {
  switch (method.toUpperCase()) {
    case "GET":
      return "bg-success/20 text-success";
    case "POST":
      return "bg-blue-500/20 text-blue-600 dark:text-blue-400";
    case "PUT":
      return "bg-warning/20 text-warning";
    case "PATCH":
      return "bg-purple-500/20 text-purple-600 dark:text-purple-400";
    case "DELETE":
      return "bg-destructive/20 text-destructive";
    default:
      return "bg-muted text-muted-foreground";
  }
}

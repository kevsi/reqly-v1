"use client";

import { useState, useCallback } from "react";
import {
  Loader2,
  FolderOpen,
  Sparkles,
  Code2,
  AlertCircle,
  CheckCircle2,
  FileSearch,
  Link2,
  Braces,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import { isTauriAvailable } from "@/lib/tauri";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { AnalysisMode, SavedProject } from "@/lib/config";
import { loadApiKey, loadAIProvider } from "@/lib/config";
import { analyzeProject, type AnalysisStage } from "../lib/project-analyzer";
import { toast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

interface NewProjectModalProps {
  open: boolean;
  onClose: () => void;
  onAdd: (p: SavedProject) => void;
}

const STAGE_ORDER: AnalysisStage[] = ["scan", "correlate", "ai", "finalize"];

const STAGE_ICONS: Record<AnalysisStage, typeof FileSearch> = {
  scan: FileSearch,
  correlate: Link2,
  ai: Sparkles,
  finalize: Braces,
};

export function NewProjectModal({ open, onClose, onAdd }: NewProjectModalProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<AnalysisMode>("static");
  const [folderPath, setFolderPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState<AnalysisStage | null>(null);
  const [doneStages, setDoneStages] = useState<AnalysisStage[]>([]);
  const [analysisResult, setAnalysisResult] = useState<SavedProject | null>(null);

  const pickFolder = async () => {
    if (isTauriAvailable()) {
      try {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const selected = await open({ directory: true, multiple: false });
        if (selected && typeof selected === "string") {
          setFolderPath(selected);
          setAnalysisResult(null);
          setDoneStages([]);
        }
      } catch {
        toast({ title: t("newProject.pickerError"), variant: "destructive" });
      }
    } else {
      toast({
        title: t("newProject.manualPath"),
        description: t("newProject.manualPathDesc"),
      });
    }
  };

  const handleStage = useCallback((s: AnalysisStage) => {
    setStage(s);
    setDoneStages((prev) => (prev.includes(s) ? prev : [...prev, s]));
  }, []);

  const analyze = async () => {
    if (!folderPath) {
      toast({ title: t("newProject.selectFolder"), variant: "destructive" });
      return;
    }
    const aiProvider = loadAIProvider();
    const aiKey = loadApiKey(aiProvider);
    if (mode === "ai" && aiProvider !== "ollama" && !aiKey.trim()) {
      toast({
        title: t("newProject.noAiKey"),
        description: t("newProject.noAiKeyDesc"),
        variant: "destructive",
      });
      return;
    }
    setLoading(true);
    setDoneStages([]);
    setStage(null);
    try {
      const result = await analyzeProject(
        folderPath,
        mode,
        aiProvider,
        mode === "ai" ? aiKey : undefined,
        handleStage,
      );
      setDoneStages((prev) => [...new Set([...prev, ...STAGE_ORDER])]);
      setStage("finalize");
      setAnalysisResult(result);
    } catch (err) {
      toast({
        title: t("newProject.error", { error: String(err) }),
        variant: "destructive",
        meta: { event: "projectAdd" },
      });
    } finally {
      setLoading(false);
      setStage(null);
    }
  };

  const handlePrimaryAction = async () => {
    if (analysisResult) {
      onAdd(analysisResult);
      onClose();
      setFolderPath("");
      setAnalysisResult(null);
      setDoneStages([]);
      return;
    }
    await analyze();
  };

  const visibleStages: AnalysisStage[] =
    mode === "ai" ? STAGE_ORDER : STAGE_ORDER.filter((s) => s !== "ai");

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="size-5 text-primary" /> {t("newProject.title")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Mode toggle */}
          <ToggleGroup
            type="single"
            value={mode}
            onValueChange={(value) => value && setMode(value as AnalysisMode)}
            className="grid grid-cols-2"
            disabled={loading}
          >
            <ToggleGroupItem value="static" className="gap-2">
              <Code2 /> {t("newProject.staticParser")}
            </ToggleGroupItem>
            <ToggleGroupItem value="ai" className="gap-2">
              <Sparkles /> {t("newProject.aiAnalysis")}
            </ToggleGroupItem>
          </ToggleGroup>

          {mode === "ai" && (
            <p className="text-xs text-muted-foreground">
              {t("newProject.aiHintPrefix")}{" "}
              <a href="/settings#ai" className="text-primary hover:underline">
                {t("newProject.settingsLabel")}
              </a>
            </p>
          )}

          {/* Folder picker */}
          <div className="flex gap-2">
            <Input
              value={folderPath}
              onChange={(e) => {
                setFolderPath(e.target.value);
                setAnalysisResult(null);
                setDoneStages([]);
              }}
              readOnly={isTauriAvailable()}
              disabled={loading}
              placeholder={t("newProject.folderPathPlaceholder")}
              className="flex-1 text-sm"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={pickFolder}
              disabled={loading}
              className="shrink-0 gap-1.5"
            >
              <FolderOpen className="size-4" /> {t("newProject.browse")}
            </Button>
          </div>
          {!isTauriAvailable() && (
            <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
              <AlertCircle className="size-3" />
              {t("newProject.browserMode")}
            </p>
          )}

          {/* Analysis in progress: staged stepper */}
          {loading && (
            <div className="rounded-xl border border-border/60 bg-muted/5 p-4">
              <p className="mb-3 text-sm font-medium text-foreground">
                {t("newProject.analyzing")}
              </p>
              <div className="space-y-2">
                {visibleStages.map((s) => {
                  const Icon = STAGE_ICONS[s];
                  const isDone = doneStages.includes(s);
                  const isActive = stage === s && !isDone;
                  return (
                    <div key={s} className="flex items-center gap-2.5">
                      <div
                        className={cn(
                          "flex size-5 shrink-0 items-center justify-center rounded-full border",
                          isDone
                            ? "border-success/40 bg-success/10 text-success"
                            : isActive
                              ? "border-primary/40 bg-primary/10 text-primary"
                              : "border-border text-muted-foreground/40",
                        )}
                      >
                        {isDone ? (
                          <CheckCircle2 className="size-3" />
                        ) : (
                          <Icon className={cn("size-3", isActive && "animate-pulse")} />
                        )}
                      </div>
                      <span
                        className={cn(
                          "text-sm",
                          isDone
                            ? "text-foreground"
                            : isActive
                              ? "text-foreground font-medium"
                              : "text-muted-foreground/50",
                        )}
                      >
                        {t(`newProject.stage.${s}`)}
                      </span>
                      {isActive && <Loader2 className="ml-auto size-3 animate-spin text-primary" />}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Compact summary after analysis — full result opens in RouteModal */}
          {analysisResult && !loading && (
            <div className="rounded-xl border border-border/60 bg-muted/5 p-4">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-success">
                <CheckCircle2 className="size-3.5" />
                {t("newProject.resultTitle")}
              </p>
              <div className="space-y-1 text-sm">
                <p className="text-foreground">
                  <span className="text-muted-foreground">{t("newProject.languageLabel")} :</span>{" "}
                  <strong>{analysisResult.language ?? t("newProject.unknown")}</strong>
                </p>
                <p className="text-foreground">
                  <span className="text-muted-foreground">{t("newProject.frameworkLabel")} :</span>{" "}
                  <strong>{analysisResult.framework}</strong>
                </p>
                <p className="text-foreground">
                  <span className="text-muted-foreground">{t("newProject.routesLabel")} :</span>{" "}
                  <strong>{analysisResult.routes.length}</strong>
                </p>
                {analysisResult.port && (
                  <p className="text-foreground">
                    <span className="text-muted-foreground">{t("newProject.portLabel")} :</span>{" "}
                    <strong>{analysisResult.port}</strong>
                  </p>
                )}
              </div>
            </div>
          )}

          <Button
            className="w-full gap-2"
            onClick={handlePrimaryAction}
            disabled={loading || !folderPath}
          >
            {loading ? (
              <>
                <Loader2 className="size-4 animate-spin" /> {t("newProject.analyzing")}
              </>
            ) : analysisResult ? (
              <>
                <CheckCircle2 className="size-4" /> {t("newProject.addProject")}
              </>
            ) : (
              <>
                <Sparkles className="size-4" /> {t("newProject.analyze")}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

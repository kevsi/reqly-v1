"use client";

import { useState } from "react";
import { Loader2, FolderOpen, Sparkles, Code2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import { isTauriAvailable } from "@/lib/tauri";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { AnalysisMode, SavedProject } from "@/lib/config";
import { loadApiKey, loadAIProvider } from "@/lib/config";
import { analyzeProject } from "../lib/project-analyzer";
import { toast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";

interface NewProjectModalProps {
  open: boolean;
  onClose: () => void;
  onAdd: (p: SavedProject) => void;
}

export function NewProjectModal({ open, onClose, onAdd }: NewProjectModalProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<AnalysisMode>("static");
  const [folderPath, setFolderPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState("");
  const [analysisResult, setAnalysisResult] = useState<SavedProject | null>(null);

  const pickFolder = async () => {
    if (isTauriAvailable()) {
      try {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const selected = await open({ directory: true, multiple: false });
        if (selected && typeof selected === "string") {
          setFolderPath(selected);
          setAnalysisResult(null);
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
    try {
      setStep(t("newProject.analyzing"));
      const result = await analyzeProject(
        folderPath,
        mode,
        aiProvider,
        mode === "ai" ? aiKey : undefined,
      );
      setAnalysisResult(result);
      toast({
        title: t("newProject.languageDetected", {
          language: result.language ?? t("newProject.unknown"),
        }),
        meta: { event: "projectAdd" },
      });
    } catch (err) {
      toast({
        title: t("newProject.error", { error: String(err) }),
        variant: "destructive",
        meta: { event: "projectAdd" },
      });
    } finally {
      setLoading(false);
      setStep("");
    }
  };

  const handlePrimaryAction = async () => {
    if (analysisResult) {
      onAdd(analysisResult);
      toast({
        title: t("newProject.routesDetected", { count: analysisResult.routes.length }),
        meta: { event: "projectAdd" },
      });
      onClose();
      setFolderPath("");
      setAnalysisResult(null);
      return;
    }
    await analyze();
  };

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
              }}
              readOnly={isTauriAvailable()}
              placeholder={t("newProject.folderPathPlaceholder")}
              className="flex-1 text-sm"
            />
            <Button variant="outline" size="sm" onClick={pickFolder} className="shrink-0 gap-1.5">
              <FolderOpen className="size-4" /> {t("newProject.browse")}
            </Button>
          </div>
          {!isTauriAvailable() && (
            <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
              <AlertCircle className="size-3" />
              {t("newProject.browserMode")}
            </p>
          )}

          {analysisResult && (
            <div className="rounded-2xl border border-border/50 bg-muted/10 p-4 text-sm text-foreground">
              <p>
                <strong>{t("newProject.languageLabel")} :</strong>{" "}
                {analysisResult.language ?? t("newProject.unknown")}
              </p>
              <p>
                <strong>{t("newProject.frameworkLabel")} :</strong> {analysisResult.framework}
              </p>
              <p>
                <strong>{t("newProject.routesLabel")} :</strong> {analysisResult.routes.length}
              </p>
              {analysisResult.port && (
                <p>
                  <strong>{t("newProject.portLabel")} :</strong> {analysisResult.port}
                </p>
              )}
            </div>
          )}

          <Button
            className="w-full gap-2"
            onClick={handlePrimaryAction}
            disabled={loading || !folderPath}
          >
            {loading ? (
              <>
                <Loader2 className="size-4 animate-spin" /> {step || t("newProject.analyzing")}
              </>
            ) : analysisResult ? (
              <>
                <Sparkles className="size-4" /> {t("newProject.addProject")}
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

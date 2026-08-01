"use client";

import { useState } from "react";
import { Loader2, FolderOpen, Sparkles, Code2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { isTauriAvailable } from "@/lib/tauri";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { AnalysisMode, SavedProject } from "@/lib/config";
import { loadApiKey, loadAIProvider } from "@/lib/config";
import { analyzeProject } from "../lib/project-analyzer";
import { toast } from "@/hooks/use-toast";

interface NewProjectModalProps {
  open: boolean;
  onClose: () => void;
  onAdd: (p: SavedProject) => void;
}

export function NewProjectModal({ open, onClose, onAdd }: NewProjectModalProps) {
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
        toast({ title: "Impossible d'ouvrir le sélecteur de dossier", variant: "destructive" });
      }
    } else {
      toast({
        title: "Saisissez le chemin du dossier manuellement",
        description: "Le sélecteur natif est disponible via l'application de bureau.",
      });
    }
  };

  const analyze = async () => {
    if (!folderPath) {
      toast({ title: "Sélectionnez un dossier", variant: "destructive" });
      return;
    }
    const aiProvider = loadAIProvider();
    const aiKey = loadApiKey(aiProvider);
    if (mode === "ai" && aiProvider !== "ollama" && !aiKey.trim()) {
      toast({
        title: "Aucune clé IA configurée",
        description: "Configurez un provider IA dans les Settings",
        variant: "destructive",
      });
      return;
    }
    setLoading(true);
    try {
      setStep("Analyse en cours…");
      const result = await analyzeProject(
        folderPath,
        mode,
        aiProvider,
        mode === "ai" ? aiKey : undefined,
      );
      setAnalysisResult(result);
      toast({
        title: `Langage détecté : ${result.language ?? "Inconnu"}`,
        meta: { event: "projectAdd" },
      } as any);
    } catch (err) {
      toast({
        title: `Erreur : ${String(err)}`,
        variant: "destructive",
        meta: { event: "projectAdd" },
      } as any);
    } finally {
      setLoading(false);
      setStep("");
    }
  };

  const handlePrimaryAction = async () => {
    if (analysisResult) {
      onAdd(analysisResult);
      toast({
        title: `${analysisResult.routes.length} routes détectées`,
        meta: { event: "projectAdd" },
      } as any);
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
            <FolderOpen className="size-5 text-primary" /> Nouveau projet
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
              <Code2 /> Parser statique
            </ToggleGroupItem>
            <ToggleGroupItem value="ai" className="gap-2">
              <Sparkles /> Analyse IA
            </ToggleGroupItem>
          </ToggleGroup>

          {mode === "ai" && (
            <p className="text-xs text-muted-foreground">
              Utilise le provider IA configuré dans les{" "}
              <a href="/settings#ai" className="text-primary hover:underline">
                Settings
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
              placeholder="Chemin du dossier…"
              className="flex-1 text-sm"
            />
            <Button variant="outline" size="sm" onClick={pickFolder} className="shrink-0 gap-1.5">
              <FolderOpen className="size-4" /> Parcourir
            </Button>
          </div>
          {!isTauriAvailable() && (
            <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
              <AlertCircle className="size-3" />
              Mode navigateur : entrez le chemin manuellement ou installez l'app de bureau
            </p>
          )}

          {analysisResult && (
            <div className="rounded-2xl border border-border/50 bg-muted/10 p-4 text-sm text-foreground">
              <p>
                <strong>Langage détecté :</strong> {analysisResult.language ?? "Inconnu"}
              </p>
              <p>
                <strong>Framework :</strong> {analysisResult.framework}
              </p>
              <p>
                <strong>Routes :</strong> {analysisResult.routes.length}
              </p>
              {analysisResult.port && (
                <p>
                  <strong>Port :</strong> {analysisResult.port}
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
                <Loader2 className="size-4 animate-spin" /> {step || "Analyse…"}
              </>
            ) : analysisResult ? (
              <>
                <Sparkles className="size-4" /> Ajouter le projet
              </>
            ) : (
              <>
                <Sparkles className="size-4" /> Analyser
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

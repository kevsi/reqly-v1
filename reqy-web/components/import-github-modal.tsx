"use client";

import { useCallback, useEffect, useState } from "react";
import { Github, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import type { SavedProject, AnalysisMode } from "@/lib/types";

interface ImportGithubModalProps {
  open: boolean;
  onClose: () => void;
  onImport: (project: SavedProject) => void;
}

export function ImportGithubModal({ open, onClose, onImport }: ImportGithubModalProps) {
  const [repoUrl, setRepoUrl] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [projectPreview, setProjectPreview] = useState<{
    framework: string;
    language?: string;
    port?: number;
    routes: any[];
  } | null>(null);
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>("static");
  const [githubRepos, setGithubRepos] = useState<Array<{
    id: number;
    full_name: string;
    name: string;
    owner: { login: string };
    html_url: string;
    description?: string;
    default_branch: string;
  }> | null>(null);
  const [reposLoading, setReposLoading] = useState(false);
  const [reposError, setReposError] = useState<string | null>(null);

  const parseGithubUrl = (url: string): { owner: string; repo: string; branch?: string } | null => {
    try {
      // Handle various GitHub URL formats
      const cleaned = url.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "");
      const parts = cleaned.split("/");
      if (parts.length >= 2) {
        return {
          owner: parts[0],
          repo: parts[1],
          branch: parts[3] === "tree" ? parts[4] : undefined,
        };
      }
    } catch {
      // Ignore parse errors
    }
    return null;
  };

  const fetchGithubRepos = useCallback(async () => {
    setReposLoading(true);
    setReposError(null);
    try {
      const response = await fetch("/api/github-auth/repos");
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        setReposError(error.message || "Impossible de charger les dépôts GitHub");
        setGithubRepos([]);
        return;
      }

      const data = await response.json();
      setGithubRepos(data.repos || []);
    } catch {
      setReposError("Impossible de charger les dépôts GitHub");
      setGithubRepos([]);
    } finally {
      setReposLoading(false);
    }
  }, []);

  const handleSelectRepo = (fullName: string) => {
    setRepoUrl(`https://github.com/${fullName}`);
    setProjectPreview(null);
    setImportStatus(null);
  };

  useEffect(() => {
    let cleanupTimeout: number | undefined;

    if (!open) {
      cleanupTimeout = window.setTimeout(() => {
        setGithubRepos(null);
        setReposError(null);
      }, 0);
      return () => {
        if (cleanupTimeout) {
          window.clearTimeout(cleanupTimeout);
        }
      };
    }

    const fetchTimeout = window.setTimeout(() => fetchGithubRepos(), 0);
    return () => window.clearTimeout(fetchTimeout);
  }, [open, fetchGithubRepos]);

  const handleImport = async () => {
    if (projectPreview) {
      const project: SavedProject = {
        id: `proj-${Date.now()}`,
        name:
          projectPreview.framework === "unknown" ? repoUrl : `${projectPreview.framework} project`,
        framework: projectPreview.framework,
        language: projectPreview.language || undefined,
        folderPath: `github:${repoUrl}`,
        port: projectPreview.port,
        routes: projectPreview.routes,
        analyzedAt: new Date().toISOString(),
        mode: analysisMode,
      };

      onImport(project);
      toast({
        title: `Projet "${project.name}" importé avec ${project.routes.length} routes`,
        meta: { event: "importExport" },
      } as any);
      onClose();
      setRepoUrl("");
      setProjectPreview(null);
      setImportStatus(null);
      return;
    }

    const parsed = parseGithubUrl(repoUrl);
    if (!parsed) {
      toast({
        title: "URL GitHub invalide. Format: https://github.com/owner/repo",
        variant: "destructive",
      });
      return;
    }

    setIsImporting(true);
    setImportStatus("Analyse du dépôt...");

    try {
      const response = await fetch(`/api/github-import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: parsed.owner,
          repo: parsed.repo,
          branch: parsed.branch,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || "Erreur lors de l'import du dépôt");
      }

      const data = await response.json();
      setProjectPreview({
        framework: data.framework || "unknown",
        language: data.language || undefined,
        port: data.port,
        routes: data.routes || [],
      });
      setImportStatus("Aperçu du projet prêt");
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "Erreur lors de l'import",
        variant: "destructive",
        meta: { event: "importExport" },
      } as any);
      setProjectPreview(null);
    } finally {
      setIsImporting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-xl border bg-card p-6 shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Github className="size-5 text-primary" />
            <h2 className="text-lg font-semibold">Importer depuis GitHub</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">URL du dépôt GitHub</label>
            <Input
              placeholder="https://github.com/owner/repo"
              value={repoUrl}
              onChange={(e) => {
                setRepoUrl(e.target.value);
                setProjectPreview(null);
                setImportStatus(null);
              }}
              disabled={isImporting}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Exemple: https://github.com/fastapi/full-stack-fastapi-postgresql
            </p>
          </div>

          <div className="rounded-2xl border border-border/50 bg-muted p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">Dépôts GitHub connectés</p>
              {reposLoading ? (
                <span className="text-xs text-muted-foreground">Chargement...</span>
              ) : null}
            </div>
            {reposLoading ? (
              <p className="text-sm text-muted-foreground">Chargement des dépôts GitHub...</p>
            ) : reposError ? (
              <p className="text-sm text-destructive">{reposError}</p>
            ) : githubRepos && githubRepos.length > 0 ? (
              <div className="space-y-2">
                <Select
                  value={repoUrl.startsWith("https://github.com/") ? repoUrl : ""}
                  onValueChange={(value) => {
                    setRepoUrl(value);
                    setProjectPreview(null);
                    setImportStatus(null);
                  }}
                >
                  <SelectTrigger className="w-full" size="sm">
                    <SelectValue placeholder="Sélectionner un dépôt..." />
                  </SelectTrigger>
                  <SelectContent>
                    {githubRepos.slice(0, 15).map((repo) => (
                      <SelectItem key={repo.id} value={`https://github.com/${repo.full_name}`}>
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium">{repo.full_name}</span>
                          <span className="text-xs text-muted-foreground">
                            {repo.default_branch}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Choisis un dépôt pour pré-remplir l’URL et lancer l’analyse.
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Connectez-vous dans les paramètres pour afficher vos dépôts GitHub.
              </p>
            )}
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">Méthode d'analyse</label>
            <ToggleGroup
              type="single"
              value={analysisMode}
              onValueChange={(value) => value && setAnalysisMode(value as AnalysisMode)}
            >
              <ToggleGroupItem value="static" className="flex-1">
                Statique
              </ToggleGroupItem>
              <ToggleGroupItem value="ai" className="flex-1">
                IA
              </ToggleGroupItem>
            </ToggleGroup>
            <p className="text-xs text-muted-foreground mt-1.5">
              {analysisMode === "static"
                ? "Détecte les routes par regex (plus rapide)"
                : "Analyse approfondie avec IA (plus précis)"}
            </p>
          </div>

          {importStatus && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {isImporting ? <Loader2 className="size-4 animate-spin" /> : null}
              {importStatus}
            </div>
          )}

          {projectPreview && (
            <div className="rounded-2xl border border-border/50 bg-muted/10 p-4 text-sm text-foreground">
              <p>
                <strong>Langage détecté :</strong> {projectPreview.language ?? "Inconnu"}
              </p>
              <p>
                <strong>Framework :</strong> {projectPreview.framework}
              </p>
              <p>
                <strong>Routes :</strong> {projectPreview.routes.length}
              </p>
              {projectPreview.port && (
                <p>
                  <strong>Port :</strong> {projectPreview.port}
                </p>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={isImporting}>
              Annuler
            </Button>
            <Button onClick={handleImport} disabled={!repoUrl || isImporting}>
              {isImporting && <Loader2 className="size-4 mr-2 animate-spin" />}
              {projectPreview ? "Importer le projet" : "Analyser"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

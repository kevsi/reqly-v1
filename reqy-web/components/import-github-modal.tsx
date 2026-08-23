"use client";

import { useCallback, useEffect, useState } from "react";
import { Github, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import type { SavedProject, AnalysisMode } from "@/lib/types";
import { useTranslation } from "react-i18next";
import { useRouter } from "next/navigation";
import { isTauriAvailable } from "@/lib/tauri";
import { secureKeys } from "@/lib/secure-storage";
import { OAUTH_TOKEN_KEYS } from "@/hooks/use-tool-connections";

interface ImportGithubModalProps {
  open: boolean;
  onClose: () => void;
  onImport: (project: SavedProject) => void;
}

export function ImportGithubModal({ open, onClose, onImport }: ImportGithubModalProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const [repoUrl, setRepoUrl] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [projectPreview, setProjectPreview] = useState<{
    framework: string;
    language?: string;
    port?: number;
    routes: SavedProject["routes"];
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

  const GITHUB_REPOS_URL =
    "https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,organization_member";

  const normalizeRepo = (repo: Record<string, unknown>) => ({
    id: repo.id as number,
    full_name: repo.full_name as string,
    name: repo.name as string,
    owner: {
      login: ((repo.owner as Record<string, unknown> | undefined)?.login as string) ?? "",
    },
    html_url: repo.html_url as string,
    description: repo.description as string | undefined,
    default_branch: repo.default_branch as string,
  });

  const fetchGithubRepos = useCallback(async () => {
    setReposLoading(true);
    setReposError(null);
    try {
      // Desktop (Tauri static export): API routes don't exist — read the
      // token from the encrypted secure store and call GitHub directly.
      if (isTauriAvailable()) {
        await secureKeys.waitForReady();
        const token = secureKeys.get(OAUTH_TOKEN_KEYS.github);
        if (!token) {
          setGithubRepos([]);
          return;
        }
        const response = await fetch(GITHUB_REPOS_URL, {
          headers: {
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "api-playground",
            Authorization: `Bearer ${token}`,
          },
        });
        if (!response.ok) {
          setReposError(t("importExport.github.repoLoadError"));
          setGithubRepos([]);
          return;
        }
        const data: unknown = await response.json();
        setGithubRepos(
          Array.isArray(data) ? (data as Record<string, unknown>[]).map(normalizeRepo) : [],
        );
        return;
      }

      const response = await fetch("/api/github-auth/repos");
      const data = await response.json().catch(() => ({}));
      // 401 with connected:false = not authenticated — show connect hint,
      // not an error.
      if (response.status === 401 || data.connected === false) {
        setGithubRepos([]);
        return;
      }
      if (!response.ok) {
        setReposError(data.message || t("importExport.github.repoLoadError"));
        setGithubRepos([]);
        return;
      }

      setGithubRepos(data.repos || []);
    } catch {
      setReposError(t("importExport.github.repoLoadError"));
      setGithubRepos([]);
    } finally {
      setReposLoading(false);
    }
  }, [t]);

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
        title: t("importExport.github.projectImported", {
          name: project.name,
          count: project.routes.length,
        }),
        meta: { event: "importExport" },
      });
      onClose();
      setRepoUrl("");
      setProjectPreview(null);
      setImportStatus(null);
      return;
    }

    const parsed = parseGithubUrl(repoUrl);
    if (!parsed) {
      toast({
        title: t("importExport.github.invalidUrl"),
        variant: "destructive",
      });
      return;
    }

    setIsImporting(true);
    setImportStatus(t("importExport.github.analyzing"));

    try {
      let githubToken: string | undefined;
      if (isTauriAvailable()) {
        await secureKeys.waitForReady();
        githubToken = secureKeys.get(OAUTH_TOKEN_KEYS.github);
      }

      const response = await fetch(`/api/github-import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: parsed.owner,
          repo: parsed.repo,
          branch: parsed.branch,
          githubToken,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || t("importExport.github.importError"));
      }

      const data = await response.json();
      setProjectPreview({
        framework: data.framework || "unknown",
        language: data.language || undefined,
        port: data.port,
        routes: data.routes || [],
      });
      setImportStatus(t("importExport.github.previewReady"));
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : t("importExport.common.importError"),
        variant: "destructive",
        meta: { event: "importExport" },
      });
      setProjectPreview(null);
    } finally {
      setIsImporting(false);
    }
  };

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Github className="size-5 text-primary" />
            <DialogTitle>{t("importExport.github.title")}</DialogTitle>
          </div>
          <DialogDescription>{t("importExport.github.repoUrl")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
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
          <p className="text-xs text-muted-foreground">{t("importExport.github.example")}</p>

          <div className="rounded-2xl border border-border/50 bg-muted p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">{t("importExport.github.connectedRepos")}</p>
              {reposLoading ? (
                <span className="text-xs text-muted-foreground">{t("common.loading")}</span>
              ) : null}
            </div>
            {reposLoading ? (
              <p className="text-sm text-muted-foreground">
                {t("importExport.github.loadingRepos")}
              </p>
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
                    <SelectValue placeholder={t("importExport.github.selectRepo")} />
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
                  {t("importExport.github.selectHint")}
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-start gap-3">
                <p className="text-sm text-muted-foreground">
                  {t("importExport.github.connectHint")}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs"
                  onClick={() => {
                    onClose();
                    router.push("/settings");
                  }}
                >
                  {t("importExport.postman.goToSettings")}
                </Button>
              </div>
            )}
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">
              {t("importExport.github.analysisMethod")}
            </label>
            <ToggleGroup
              type="single"
              value={analysisMode}
              onValueChange={(value) => value && setAnalysisMode(value as AnalysisMode)}
            >
              <ToggleGroupItem value="static" className="flex-1">
                {t("importExport.github.static")}
              </ToggleGroupItem>
              <ToggleGroupItem value="ai" className="flex-1">
                {t("importExport.github.ai")}
              </ToggleGroupItem>
            </ToggleGroup>
            <p className="text-xs text-muted-foreground mt-1.5">
              {analysisMode === "static"
                ? t("importExport.github.staticHint")
                : t("importExport.github.aiHint")}
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
                <strong>{t("importExport.github.detectedLanguage")}</strong>{" "}
                {projectPreview.language ?? t("common.unknown")}
              </p>
              <p>
                <strong>{t("importExport.github.framework")}</strong> {projectPreview.framework}
              </p>
              <p>
                <strong>{t("importExport.github.routes")}</strong> {projectPreview.routes.length}
              </p>
              {projectPreview.port && (
                <p>
                  <strong>{t("importExport.github.port")}</strong> {projectPreview.port}
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={onClose} disabled={isImporting}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleImport} disabled={!repoUrl || isImporting}>
              {isImporting && <Loader2 className="size-4 mr-2 animate-spin" />}
              {projectPreview
                ? t("importExport.github.importProject")
                : t("importExport.github.analyze")}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

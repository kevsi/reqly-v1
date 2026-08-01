"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Loader2,
  Search,
  GitFork,
  FileText,
  FolderIcon,
  FileCode,
  ChevronRight,
  CheckCircle2,
  ArrowLeft,
  Globe,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getFileTypeLabel } from "@/lib/gitlab";

// ─── Types ─────────────────────────────────────────────────────────────────

interface GitLabProject {
  id: number;
  name: string;
  path_with_namespace: string;
  description: string | null;
  default_branch: string;
  avatar_url: string | null;
}

interface GitLabTreeItem {
  id: string;
  name: string;
  type: "tree" | "blob";
  path: string;
}

type Step = "projects" | "files" | "importing" | "done";

interface SelectedFile {
  path: string;
  name: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

const IMPORTABLE_EXTENSIONS = new Set([".bru", ".json", ".yaml", ".yml"]);

function isImportableFile(name: string): boolean {
  return IMPORTABLE_EXTENSIONS.has(name.toLowerCase().split(".").pop()!);
}

// ─── Component ─────────────────────────────────────────────────────────────

interface GitLabImportModalProps {
  open: boolean;
  onClose: () => void;
  onImport: (
    collections: Array<{
      name: string;
      description?: string;
      color: string;
      icon: string;
      requests: Array<{
        name: string;
        method: string;
        url: string;
        endpoint: string;
        headers?: Record<string, string>;
        body?: string;
        bodyType?: "json" | "form-data" | "x-www-form" | "raw" | "binary";
      }>;
    }>,
  ) => void;
}

export function GitLabImportModal({ open, onClose, onImport }: GitLabImportModalProps) {
  const [step, setStep] = useState<Step>("projects");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Projects step
  const [projects, setProjects] = useState<GitLabProject[]>([]);
  const [search, setSearch] = useState("");

  // Files step
  const [selectedProject, setSelectedProject] = useState<GitLabProject | null>(null);
  const [files, setFiles] = useState<GitLabTreeItem[]>([]);
  const [fileLoading, setFileLoading] = useState(false);
  const [currentPath, setCurrentPath] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  const fetchedRef = useRef(false);

  // ─── Reset ─────────────────────────────────────────────────────────

  const reset = useCallback(() => {
    setStep("projects");
    setError(null);
    setProjects([]);
    setSearch("");
    setSelectedProject(null);
    setFiles([]);
    setCurrentPath("");
    setSelectedFiles([]);
  }, []);

  const handleClose = () => {
    reset();
    onClose();
  };

  // ─── Fetch projects ────────────────────────────────────────────────

  const fetchProjects = useCallback(async (searchTerm?: string) => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ action: "projects" });
      if (searchTerm) params.set("search", searchTerm);

      const res = await fetch(`/api/gitlab-api?${params}`, {
        credentials: "include",
        signal: controller.signal,
      });
      const data = await res.json();

      if (!res.ok) {
        if (res.status === 401) {
          setError("GitLab n'est pas connecté. Allez dans Settings → Outils connectés.");
        } else {
          setError(data.error || "Erreur lors du chargement des projets");
        }
        return;
      }

      setProjects(data.projects || []);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError("Erreur réseau. Vérifiez votre connexion.");
    } finally {
      if (abortRef.current === controller) {
        setLoading(false);
        abortRef.current = null;
      }
    }
  }, []);

  // ─── Fetch files ──────────────────────────────────────────────────

  const fetchFiles = useCallback(
    async (projectId: number, path?: string) => {
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setFileLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          action: "tree",
          projectId: String(projectId),
        });
        if (path) params.set("path", path);
        if (selectedProject?.default_branch) params.set("ref", selectedProject.default_branch);

        const res = await fetch(`/api/gitlab-api?${params}`, {
          credentials: "include",
          signal: controller.signal,
        });
        const data = await res.json();

        if (!res.ok) {
          setError(data.error || "Erreur lors du chargement des fichiers");
          return;
        }

        setFiles(data.items || []);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError("Erreur réseau");
      } finally {
        if (abortRef.current === controller) {
          setFileLoading(false);
          abortRef.current = null;
        }
      }
    },
    [selectedProject],
  );

  // Load projects when modal opens
  useEffect(() => {
    if (open && !fetchedRef.current) {
      fetchedRef.current = true;
      void fetchProjects();
    } else if (!open) {
      fetchedRef.current = false;
      abortRef.current?.abort();
      abortRef.current = null;
    }
    return () => {
      abortRef.current?.abort();
    };
  }, [open, fetchProjects]);

  // ─── Handlers ─────────────────────────────────────────────────────

  const handleSearch = () => {
    void fetchProjects(search || undefined);
  };

  const handleSelectProject = (project: GitLabProject) => {
    setSelectedProject(project);
    setCurrentPath("");
    setSelectedFiles([]);
    setFiles([]);
    setStep("files");
    void fetchFiles(project.id);
  };

  const handleOpenDir = (item: GitLabTreeItem) => {
    if (!selectedProject) return;
    setCurrentPath(item.path);
    void fetchFiles(selectedProject.id, item.path);
  };

  const handleGoBack = () => {
    if (!selectedProject) return;
    const parent = currentPath.split("/").slice(0, -1).join("/");
    setCurrentPath(parent);
    void fetchFiles(selectedProject.id, parent || undefined);
  };

  const handleBackToProjects = () => {
    setStep("projects");
    setSelectedProject(null);
    setFiles([]);
    setSelectedFiles([]);
  };

  const toggleFileSelection = (item: GitLabTreeItem) => {
    setSelectedFiles((prev) => {
      const exists = prev.some((f) => f.path === item.path);
      if (exists) {
        return prev.filter((f) => f.path !== item.path);
      }
      return [...prev, { path: item.path, name: item.name }];
    });
  };

  // ─── Import ───────────────────────────────────────────────────────

  const handleImport = async () => {
    if (!selectedProject || selectedFiles.length === 0) return;

    setStep("importing");
    setError(null);

    const imported: Array<{
      name: string;
      description?: string;
      color: string;
      icon: string;
      requests: Array<{
        name: string;
        method: string;
        url: string;
        endpoint: string;
        headers?: Record<string, string>;
        body?: string;
        bodyType?: "json" | "form-data" | "x-www-form" | "raw" | "binary";
      }>;
    }> = [];

    for (const file of selectedFiles) {
      try {
        const params = new URLSearchParams({
          action: "raw",
          projectId: String(selectedProject.id),
          filePath: file.path,
        });
        if (selectedProject.default_branch) {
          params.set("ref", selectedProject.default_branch);
        }

        const res = await fetch(`/api/gitlab-api?${params}`, {
          credentials: "include",
        });
        const data = await res.json();

        if (!res.ok) continue;

        const result = await parseFileContent(data.content, file.name);
        if (result) {
          imported.push(result);
        }
      } catch {
        // Skip files that fail to parse
      }
    }

    if (imported.length === 0) {
      setError("Aucun fichier valide n'a pu être importé.");
      setStep("files");
      return;
    }

    // Merge collections with the same name
    const merged = mergeCollections(imported);
    onImport(merged);
    setStep("done");

    setTimeout(() => {
      handleClose();
    }, 2000);
  };

  // ─── Render: Projects step ────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitFork className="size-5" />
            Importer depuis GitLab
          </DialogTitle>
          <DialogDescription>
            {step === "projects" && "Sélectionnez un projet GitLab pour parcourir ses fichiers."}
            {step === "files" &&
              selectedProject &&
              `Parcourez ${selectedProject.path_with_namespace} et sélectionnez les fichiers à importer.`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0">
          {step === "projects" && renderProjects()}
          {step === "files" && renderFiles()}
          {step === "importing" && renderImporting()}
          {step === "done" && renderDone()}
        </div>

        <DialogFooter className="gap-2">
          {step === "files" && (
            <>
              <Button variant="ghost" onClick={handleBackToProjects}>
                <ArrowLeft className="size-4 mr-1" />
                Projets
              </Button>
              <Button variant="outline" onClick={handleClose}>
                Annuler
              </Button>
              <Button onClick={handleImport} disabled={selectedFiles.length === 0}>
                Importer {selectedFiles.length > 0 && `(${selectedFiles.length})`}
              </Button>
            </>
          )}
          {step === "projects" && (
            <>
              <Button variant="outline" onClick={handleClose}>
                Annuler
              </Button>
            </>
          )}
          {step === "done" && <Button onClick={handleClose}>Terminé</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  // ─── Render: Projects list ────────────────────────────────────────

  function renderProjects() {
    return (
      <div className="space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Rechercher un projet..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="pl-8"
            />
          </div>
          <Button variant="secondary" size="icon" onClick={handleSearch} disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
          </Button>
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : projects.length === 0 && !error ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
            <GitFork className="size-8 opacity-30" />
            <p>Aucun projet trouvé.</p>
            {!search && (
              <p>Assurez-vous d&apos;avoir des projets GitLab et que GitLab est connecté.</p>
            )}
          </div>
        ) : (
          <ScrollArea className="max-h-[400px] pr-1">
            <div className="space-y-1">
              {projects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => handleSelectProject(project)}
                  className="flex w-full items-center gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:bg-accent"
                >
                  {project.avatar_url ? (
                    <img
                      src={project.avatar_url}
                      alt=""
                      className="size-8 shrink-0 rounded object-contain"
                    />
                  ) : (
                    <div className="flex size-8 shrink-0 items-center justify-center rounded bg-muted">
                      <GitFork className="size-4 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{project.path_with_namespace}</p>
                    {project.description && (
                      <p className="truncate text-xs text-muted-foreground">
                        {project.description}
                      </p>
                    )}
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    );
  }

  // ─── Render: Files browser ────────────────────────────────────────

  function renderFiles() {
    const blobs = files.filter((f) => f.type === "blob" && isImportableFile(f.name));
    const trees = files.filter((f) => f.type === "tree");

    return (
      <div className="space-y-3">
        {selectedProject && (
          <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-2 text-sm">
            <Globe className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate font-medium">
              {selectedProject.path_with_namespace}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              ({selectedProject.default_branch})
            </span>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          {selectedProject && (
            <button
              type="button"
              className="font-medium text-primary hover:underline"
              onClick={handleBackToProjects}
            >
              {selectedProject.path_with_namespace}
            </button>
          )}
          {currentPath && (
            <>
              <span className="mx-1">/</span>
              <span className="truncate">{currentPath}</span>
            </>
          )}
          {!fileLoading && (
            <span className="ml-auto text-xs">
              {blobs.length} fichier{blobs.length > 1 ? "s" : ""} importable
              {blobs.length > 1 ? "s" : ""}
              {selectedFiles.length > 0 && (
                <>
                  {" "}
                  · {selectedFiles.length} sélectionné{selectedFiles.length > 1 ? "s" : ""}
                </>
              )}
            </span>
          )}
        </div>

        {fileLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : (
          <ScrollArea className="max-h-[350px] pr-1">
            <div className="space-y-0.5">
              {/* Parent directory link */}
              {currentPath && (
                <button
                  type="button"
                  onClick={handleGoBack}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent"
                >
                  <FolderIcon className="size-4" />
                  <span>..</span>
                </button>
              )}

              {/* Folders */}
              {trees.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleOpenDir(item)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                >
                  <FolderIcon className="size-4 shrink-0 text-amber-500" />
                  <span className="min-w-0 truncate">{item.name}</span>
                  <ChevronRight className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
                </button>
              ))}

              {/* Files */}
              {blobs.length === 0 && trees.length === 0 && !currentPath && (
                <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
                  <FileText className="size-8 opacity-30" />
                  <p>Aucun fichier importable dans ce projet.</p>
                  <p className="text-xs">
                    Types supportés : .bru, .json (Postman, OpenAPI), .yaml/.yml (OpenAPI)
                  </p>
                </div>
              )}

              {blobs.length === 0 && trees.length === 0 && currentPath && (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  Ce dossier est vide.
                </div>
              )}

              {blobs.map((item) => {
                const isSelected = selectedFiles.some((f) => f.path === item.path);
                const fileType = getFileTypeLabel(
                  item.name.endsWith(".bru")
                    ? "bruno"
                    : item.name.toLowerCase().includes("postman") ||
                        item.name.toLowerCase().includes("collection.json")
                      ? "postman"
                      : item.name.toLowerCase().endsWith(".yaml") ||
                          item.name.toLowerCase().endsWith(".yml")
                        ? "openapi-yaml"
                        : item.name.toLowerCase().includes("openapi") ||
                            item.name.toLowerCase().includes("swagger")
                          ? "openapi-json"
                          : item.name === "bruno.json"
                            ? "bruno-bundle"
                            : "unknown",
                );

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => toggleFileSelection(item)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors",
                      isSelected ? "bg-primary/10 text-primary" : "hover:bg-accent",
                    )}
                  >
                    <div
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded border",
                        isSelected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border",
                      )}
                    >
                      {isSelected && <CheckCircle2 className="size-3" />}
                    </div>
                    <FileCode className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{item.name}</span>
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {fileType}
                    </span>
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </div>
    );
  }

  // ─── Render: Importing ────────────────────────────────────────────

  function renderImporting() {
    return (
      <div className="flex flex-col items-center gap-3 py-12">
        <Loader2 className="size-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">
          Import de {selectedFiles.length} fichier{selectedFiles.length > 1 ? "s" : ""}...
        </p>
        <div className="w-full max-w-xs">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full w-2/3 animate-pulse rounded-full bg-primary" />
          </div>
        </div>
      </div>
    );
  }

  // ─── Render: Done ─────────────────────────────────────────────────

  function renderDone() {
    return (
      <div className="flex flex-col items-center gap-3 py-12">
        <div className="flex size-12 items-center justify-center rounded-full bg-success/10">
          <CheckCircle2 className="size-6 text-success" />
        </div>
        <p className="font-medium">Import terminé !</p>
        <p className="text-sm text-muted-foreground">
          Les collections ont été ajoutées à votre espace de travail.
        </p>
      </div>
    );
  }
}

// ─── File parsing helpers ───────────────────────────────────────────────────

async function parseFileContent(
  content: string,
  fileName: string,
): Promise<{
  name: string;
  color: string;
  icon: string;
  requests: Array<{
    name: string;
    method: string;
    url: string;
    endpoint: string;
    headers?: Record<string, string>;
    body?: string;
    bodyType?: "json" | "form-data" | "x-www-form" | "raw" | "binary";
  }>;
} | null> {
  const lower = fileName.toLowerCase();

  // Bruno .bru file
  if (lower.endsWith(".bru")) {
    const { parseBrunoCollection, convertBrunoToCollections } = await import("@/lib/bruno-import");
    const result = parseBrunoCollection(content, fileName);
    if (result.success) {
      const collections = convertBrunoToCollections(result);
      return collections[0];
    }
    return null;
  }

  // Bruno bundle JSON
  if (lower.endsWith(".json") || lower.endsWith(".yaml") || lower.endsWith(".yml")) {
    // Try OpenAPI parse first
    const { parseOpenApiSpec, convertToCollections } = await import("@/lib/openapi-import");
    const openApiResult = parseOpenApiSpec(content, fileName);
    if (openApiResult.success) {
      const collections = convertToCollections(openApiResult, { groupByTag: true });
      if (collections.length > 0) return collections[0];
    }

    // Try Bruno JSON parse
    const { parseBrunoCollection, convertBrunoToCollections } = await import("@/lib/bruno-import");
    const brunoResult = parseBrunoCollection(content, fileName);
    if (brunoResult.success) {
      const collections = convertBrunoToCollections(brunoResult);
      if (collections.length > 0) return collections[0];
    }
  }

  return null;
}

function mergeCollections(
  collections: Array<{
    name: string;
    color: string;
    icon: string;
    requests: Array<{
      name: string;
      method: string;
      url: string;
      endpoint: string;
      headers?: Record<string, string>;
      body?: string;
      bodyType?: "json" | "form-data" | "x-www-form" | "raw" | "binary";
    }>;
  }>,
): Array<{
  name: string;
  color: string;
  icon: string;
  requests: Array<{
    name: string;
    method: string;
    url: string;
    endpoint: string;
    headers?: Record<string, string>;
    body?: string;
    bodyType?: "json" | "form-data" | "x-www-form" | "raw" | "binary";
  }>;
}> {
  const merged = new Map<string, (typeof collections)[0]>();

  for (const col of collections) {
    const existing = merged.get(col.name);
    if (existing) {
      // Merge requests into existing collection
      existing.requests.push(...col.requests);
    } else {
      merged.set(col.name, { ...col, requests: [...col.requests] });
    }
  }

  return Array.from(merged.values());
}

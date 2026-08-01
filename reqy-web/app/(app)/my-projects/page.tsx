"use client";

import React, { useState, useCallback } from "react";
import { Github, Loader2 } from "lucide-react";
import { ProjectCard } from "@/components/project-card";
import { NewProjectModal } from "@/components/new-project-modal";
import { RouteModal } from "@/components/route-modal";
import { ImportGithubModal } from "@/components/import-github-modal";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { useRequestStore } from "@/hooks/use-request-store";
import type { SavedProject } from "@/lib/types";
import { analyzeProject } from "@/lib/project-analyzer";
import { toast } from "@/hooks/use-toast";

const MyProjectsPage: React.FC = () => {
  const { projects, addProject, deleteProject, updateProject, setSelectedProject, isLoaded } =
    useRequestStore();
  const [selectedProject, setSelectedProjectLocal] = useState<SavedProject | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isGithubModalOpen, setIsGithubModalOpen] = useState(false);
  const [pendingDeleteProject, setPendingDeleteProject] = useState<SavedProject | null>(null);
  const [reanalyzingProjectId, setReanalyzingProjectId] = useState<string | null>(null);

  const handleDeleteProject = useCallback((project: SavedProject) => {
    setPendingDeleteProject(project);
  }, []);

  const handleAddProject = useCallback(
    (newProject: SavedProject) => {
      addProject(newProject);
      setIsModalOpen(false);
    },
    [addProject],
  );

  const handleGithubImport = useCallback(
    (project: SavedProject) => {
      addProject(project);
      setIsGithubModalOpen(false);
    },
    [addProject],
  );

  const confirmDeleteProject = useCallback(() => {
    if (!pendingDeleteProject) return;
    deleteProject(pendingDeleteProject.id);
    if (selectedProject?.id === pendingDeleteProject.id) {
      setSelectedProjectLocal(null);
      setSelectedProject(null);
    }
    setPendingDeleteProject(null);
  }, [deleteProject, pendingDeleteProject, selectedProject, setSelectedProject]);

  const cancelDeleteProject = useCallback(() => {
    setPendingDeleteProject(null);
  }, []);

  const handleReanalyzeProject = useCallback(
    async (projectId: string) => {
      const project = projects.find((item) => item.id === projectId);
      if (!project) return;

      setReanalyzingProjectId(projectId);
      try {
        const analysisResult = await analyzeProject(project.folderPath, project.mode || "static");
        const updatedProject: SavedProject = {
          ...project,
          routes: analysisResult.routes,
          framework: analysisResult.framework,
          language: analysisResult.language,
          port: analysisResult.port,
          analyzedAt: new Date().toISOString(),
        };
        updateProject(projectId, {
          routes: updatedProject.routes,
          framework: updatedProject.framework,
          language: updatedProject.language,
          port: updatedProject.port,
          analyzedAt: updatedProject.analyzedAt,
        });
        if (selectedProject?.id === projectId) {
          setSelectedProjectLocal(updatedProject);
        }
        toast({
          title: `Réanalyse terminée`,
          description: `${updatedProject.routes.length} route(s) mises à jour`,
          meta: { event: "projectReanalyze" },
        });
      } catch (err) {
        toast({ title: `Échec de la réanalyse`, description: String(err), variant: "destructive" });
      } finally {
        setReanalyzingProjectId(null);
      }
    },
    [projects, selectedProject, updateProject],
  );

  // Wait for the store to finish loading from localStorage before rendering
  if (!isLoaded) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Chargement des projets…</p>
      </div>
    );
  }

  return (
    <main className="flex-1 overflow-auto p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Mes Projets</h1>
            <p className="text-sm text-muted-foreground">
              Gérez vos projets et leurs routes détectées.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              className="flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition hover:bg-accent"
              onClick={() => setIsGithubModalOpen(true)}
            >
              <Github className="size-4" />
              Importer GitHub
            </button>
            <button
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
              onClick={() => setIsModalOpen(true)}
            >
              + Nouveau projet
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              isActive={project.id === selectedProject?.id}
              onSelect={() => {
                setSelectedProjectLocal(project);
                setSelectedProject(project.id);
              }}
              onDelete={() => handleDeleteProject(project)}
              onReanalyze={() => handleReanalyzeProject(project.id)}
              isReanalyzing={reanalyzingProjectId === project.id}
            />
          ))}
        </div>
      </div>

      {isModalOpen && (
        <NewProjectModal
          open={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onAdd={handleAddProject}
        />
      )}

      <ImportGithubModal
        open={isGithubModalOpen}
        onClose={() => setIsGithubModalOpen(false)}
        onImport={handleGithubImport}
      />

      <AlertDialog
        open={!!pendingDeleteProject}
        onOpenChange={(open) => !open && setPendingDeleteProject(null)}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer le projet</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDeleteProject
                ? `Voulez-vous vraiment supprimer « ${pendingDeleteProject.name} » ? Cette action est irréversible.`
                : "Supprimer ce projet ?"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelDeleteProject}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteProject}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {selectedProject && (
        <RouteModal
          project={selectedProject}
          open={!!selectedProject}
          onClose={() => {
            setSelectedProjectLocal(null);
            setSelectedProject(null);
          }}
        />
      )}
    </main>
  );
};

export default MyProjectsPage;

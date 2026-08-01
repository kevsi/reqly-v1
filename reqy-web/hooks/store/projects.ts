"use client"

import type { SavedProject } from "@/lib/types"
import type { CommitFn } from "./types"
import { WORKSPACE_PERSONAL_ID } from "./types"

export function createProjectsMutations(commit: CommitFn) {
  const addProject = (
    project: Omit<SavedProject, "id">) => {
      commit((prev) => {
        const wsId = prev.activeWorkspaceId ?? WORKSPACE_PERSONAL_ID
        return {
          ...prev,
          projects: [
            {
              ...project,
              workspaceId: wsId,
              id: `proj-${Date.now()}`,
            },
            ...prev.projects,
          ],
        }
      })
    }

  const updateProject = (
    projectId: string, updates: Partial<SavedProject>) => {
      commit((prev) => ({
        ...prev,
        projects: prev.projects.map((p) =>
          p.id === projectId ? { ...p, ...updates } : p
        ),
      }))
    }

  const deleteProject = (
    projectId: string) => {
      commit((prev) => ({
        ...prev,
        projects: prev.projects.filter((p) => p.id !== projectId),
      }))
    }

  const setSelectedProject = (
    projectId: string | null) => {
      commit((prev) => ({ ...prev, selectedProjectId: projectId }))
    }

  return { addProject, updateProject, deleteProject, setSelectedProject }
}

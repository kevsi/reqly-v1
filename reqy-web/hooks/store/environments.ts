import type { Environment } from "@/hooks/request-types"
import { CommitFn, WORKSPACE_PERSONAL_ID } from "./types"

export function createEnvironmentsMutations(commit: CommitFn) {
  const addEnvironment = (
    env: Omit<Environment, "id" | "createdAt" | "updatedAt">) => {
      const id = `env-${Date.now()}`
      const now = Date.now()
      commit((prev) => {
        const wsId = prev.activeWorkspaceId ?? WORKSPACE_PERSONAL_ID
        const newEnv: Environment = {
          ...env,
          workspaceId: wsId,
          id,
          createdAt: now,
          updatedAt: now,
        }
        return {
          ...prev,
          environments: [...prev.environments, newEnv],
        }
      })
      return id
    }

  const updateEnvironment = (
    id: string, updates: Partial<Environment>) => {
      commit((prev) => ({
        ...prev,
        environments: prev.environments.map((e) =>
          e.id === id ? { ...e, ...updates, updatedAt: Date.now() } : e
        ),
      }))
    }

  const deleteEnvironment = (
    id: string) => {
      commit((prev) => ({
        ...prev,
        environments: prev.environments.filter((e) => e.id !== id),
        activeEnvironmentId:
          prev.activeEnvironmentId === id ? null : prev.activeEnvironmentId,
      }))
    }

  const setActiveEnvironment = (
    id: string | null) => {
      commit((prev) => ({ ...prev, activeEnvironmentId: id }))
    }

  return { addEnvironment, updateEnvironment, deleteEnvironment, setActiveEnvironment }
}

"use client"
import type { Dataset, CommitFn } from "./types"

export function createDatasetsMutations(commit: CommitFn) {
  const addDataset = (data: Omit<Dataset, "id" | "createdAt" | "updatedAt">) => {
    const id = `ds-${Date.now()}`
    commit((prev) => ({
      ...prev,
      datasets: [
        ...(prev.datasets ?? []),
        { ...data, id, createdAt: Date.now(), updatedAt: Date.now() },
      ],
    }))
    return id
  }

  const updateDataset = (id: string, updates: Partial<Dataset>) => {
    commit((prev) => ({
      ...prev,
      datasets: (prev.datasets ?? []).map((d) =>
        d.id === id ? { ...d, ...updates, updatedAt: Date.now() } : d
      ),
    }))
  }

  const deleteDataset = (id: string) => {
    commit((prev) => ({
      ...prev,
      datasets: (prev.datasets ?? []).filter((d) => d.id !== id),
    }))
  }

  return { addDataset, updateDataset, deleteDataset }
}

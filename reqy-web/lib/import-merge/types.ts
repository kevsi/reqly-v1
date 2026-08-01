export interface ImportSummary {
  added: number
  updated: number
  skipped: number
  conflicts: ImportConflict[]
}

export interface ImportConflict {
  entityType: "collection" | "environment"
  entityId: string
  entityName?: string
  localUpdatedAt: number
  importedUpdatedAt: number
  resolution: "added" | "updated" | "skipped"
}

export interface MergeInput<T extends { id: string; updatedAt?: number }> {
  local: T[]
  imported: T[]
  entityType: "collection" | "environment"
}

export interface MergeResult<T> {
  toUpsert: T[]
  summary: ImportSummary
}

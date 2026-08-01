import type { ImportConflict, ImportSummary, MergeInput, MergeResult } from "./types"

export function mergeImport<T extends { id: string; updatedAt?: number }>(
  input: MergeInput<T>
): MergeResult<T> {
  const localMap = new Map(input.local.map((e) => [e.id, e]))
  const summary: ImportSummary = { added: 0, updated: 0, skipped: 0, conflicts: [] }
  const toUpsert: T[] = []
  const now = Date.now()

  for (const imp of input.imported) {
    const loc = localMap.get(imp.id)
    const importedAt = imp.updatedAt ?? now
    const entityName = (imp as unknown as { name?: string }).name

    if (!loc) {
      // New entity — add
      toUpsert.push(imp)
      summary.added++
      summary.conflicts.push({
        entityType: input.entityType,
        entityId: imp.id,
        entityName,
        localUpdatedAt: 0,
        importedUpdatedAt: importedAt,
        resolution: "added",
      })
    } else {
      const localAt = loc.updatedAt ?? 0
      if (importedAt > localAt) {
        // Imported newer — overwrite (LWW)
        toUpsert.push(imp)
        summary.updated++
        summary.conflicts.push({
          entityType: input.entityType,
          entityId: imp.id,
          entityName,
          localUpdatedAt: localAt,
          importedUpdatedAt: importedAt,
          resolution: "updated",
        })
      } else {
        // Local newer or equal — skip (LWW: local wins ties)
        summary.skipped++
        summary.conflicts.push({
          entityType: input.entityType,
          entityId: imp.id,
          entityName,
          localUpdatedAt: localAt,
          importedUpdatedAt: importedAt,
          resolution: "skipped",
        })
      }
    }
  }

  return { toUpsert, summary }
}

export function emptySummary(): ImportSummary {
  return { added: 0, updated: 0, skipped: 0, conflicts: [] }
}

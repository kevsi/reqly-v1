import { describe, it, expect } from "vitest"
import { mergeImport, emptySummary } from "@/lib/import-merge/merge"
import type { ImportSummary } from "@/lib/import-merge/types"

describe("mergeImport — collections", () => {
  const now = Date.now()

  it("all-new entities → all added", () => {
    const local: { id: string; name: string; updatedAt: number }[] = []
    const imported = [
      { id: "c1", name: "A", updatedAt: now },
      { id: "c2", name: "B", updatedAt: now },
    ]
    const { toUpsert, summary } = mergeImport({ local, imported, entityType: "collection" })
    expect(toUpsert).toHaveLength(2)
    expect(summary.added).toBe(2)
    expect(summary.updated).toBe(0)
    expect(summary.skipped).toBe(0)
  })

  it("all-same timestamps → all skipped (LWW: local wins ties)", () => {
    const local = [{ id: "c1", name: "Old", updatedAt: now }]
    const imported = [{ id: "c1", name: "New", updatedAt: now }]
    const { toUpsert, summary } = mergeImport({ local, imported, entityType: "collection" })
    expect(toUpsert).toHaveLength(0)
    expect(summary.skipped).toBe(1)
    expect(summary.updated).toBe(0)
  })

  it("imported newer → updated (LWW)", () => {
    const local = [{ id: "c1", name: "Old", updatedAt: now - 1000 }]
    const imported = [{ id: "c1", name: "New", updatedAt: now }]
    const { toUpsert, summary } = mergeImport({ local, imported, entityType: "collection" })
    expect(toUpsert).toHaveLength(1)
    expect(toUpsert[0].name).toBe("New")
    expect(summary.updated).toBe(1)
  })

  it("local newer → skipped", () => {
    const local = [{ id: "c1", name: "Recent", updatedAt: now }]
    const imported = [{ id: "c1", name: "Stale", updatedAt: now - 1000 }]
    const { toUpsert, summary } = mergeImport({ local, imported, entityType: "collection" })
    expect(toUpsert).toHaveLength(0)
    expect(summary.skipped).toBe(1)
  })

  it("mixed: some new, some updated, some skipped", () => {
    const local = [
      { id: "c1", name: "WillBeSkipped", updatedAt: now },
      { id: "c2", name: "WillBeUpdated", updatedAt: now - 1000 },
    ]
    const imported = [
      { id: "c1", name: "Stale", updatedAt: now - 500 },
      { id: "c2", name: "Newer", updatedAt: now },
      { id: "c3", name: "BrandNew", updatedAt: now },
    ]
    const { toUpsert, summary } = mergeImport({ local, imported, entityType: "collection" })
    expect(toUpsert).toHaveLength(2)
    expect(summary.added).toBe(1)
    expect(summary.updated).toBe(1)
    expect(summary.skipped).toBe(1)
    expect(summary.conflicts).toHaveLength(3)
  })

  it("missing updatedAt on imported → treated as newest (now)", () => {
    const local = [{ id: "c1", name: "Old", updatedAt: 1000 }]
    const imported = [{ id: "c1", name: "New" }]
    const { toUpsert, summary } = mergeImport({ local, imported, entityType: "collection" })
    expect(toUpsert).toHaveLength(1)
    expect(summary.updated).toBe(1)
  })

  it("missing updatedAt on local → treated as oldest (imported wins)", () => {
    const local: { id: string; name: string }[] = [{ id: "c1", name: "Old" }]
    const imported = [{ id: "c1", name: "New", updatedAt: 1000 }]
    const importedAny = imported as unknown as { id: string; name: string; updatedAt?: number }[]
    const { toUpsert, summary } = mergeImport({ local, imported: importedAny, entityType: "collection" })
    expect(toUpsert).toHaveLength(1)
    expect(summary.updated).toBe(1)
  })

  it("conflicts log includes entity names when present", () => {
    const local = [{ id: "c1", name: "MyCollection", updatedAt: now - 1000 }]
    const imported = [{ id: "c1", name: "MyCollection v2", updatedAt: now }]
    const { summary } = mergeImport({ local, imported, entityType: "collection" })
    expect(summary.conflicts[0].entityName).toBe("MyCollection v2")
  })

  it("works with environments too", () => {
    const local = [{ id: "e1", name: "Production", updatedAt: now }]
    const imported = [{ id: "e1", name: "Production", updatedAt: now - 100 }]
    const { summary } = mergeImport({ local, imported, entityType: "environment" })
    expect(summary.skipped).toBe(1)
    expect(summary.conflicts[0].entityType).toBe("environment")
  })

  it("emptySummary returns zeroed summary", () => {
    const s = emptySummary()
    expect(s.added).toBe(0)
    expect(s.updated).toBe(0)
    expect(s.skipped).toBe(0)
    expect(s.conflicts).toEqual([])
  })
})

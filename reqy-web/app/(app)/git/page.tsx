"use client"

import { GitPanel } from "@/components/git-panel"
import { useRequestStore } from "@/hooks/use-request-store"

export default function GitPage() {
  const collections = useRequestStore((s) => s.collections)

  return (
    <main className="flex-1 overflow-hidden flex flex-col" data-testid="git-page">
      <GitPanel collections={collections} />
    </main>
  )
}

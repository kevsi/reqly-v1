"use client"

import { SSEPanel } from "@/components/sse-panel"

export default function SSEPage() {
  return (
    <main className="flex-1 overflow-hidden flex flex-col" data-testid="sse-page">
      <SSEPanel />
    </main>
  )
}

"use client"

import { GraphqlTabsManager } from "@/components/graphql/graphql-tabs-manager"

export default function GraphqlPage() {
  return (
    <main
      className="flex-1 overflow-hidden flex flex-col"
      data-testid="graphql-page"
    >
      <GraphqlTabsManager />
    </main>
  )
}

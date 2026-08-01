"use client"

import { RequestTabsManager } from "@/components/request-tabs-manager"

export default function ApiTestingDashboard() {
  return (
    <>
      {/* Subtle top accent bar (positioned relative to the layout's inner div) */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent pointer-events-none" />
      <RequestTabsManager />
    </>
  )
}

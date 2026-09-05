"use client"

import { WebSocketPanel } from "@/components/websocket-panel"

export default function WebSocketPage() {
  return (
    <main className="flex-1 overflow-hidden flex flex-col" data-testid="websocket-page">
      <WebSocketPanel />
    </main>
  )
}

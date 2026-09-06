"use client"

import { GrpcPanel } from "@/components/grpc-panel"

export default function GrpcPage() {
  return (
    <main className="flex-1 overflow-hidden flex flex-col" data-testid="grpc-page">
      <GrpcPanel />
    </main>
  )
}

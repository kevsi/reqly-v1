"use client";

import { RequestChainWorkflow } from "@/components/request-chain-workflow";

export default function ChainsPage() {
  return (
    <main className="flex-1 overflow-auto p-6" data-testid="chains-page">
      <div className="max-w-5xl mx-auto">
        <RequestChainWorkflow />
      </div>
    </main>
  );
}

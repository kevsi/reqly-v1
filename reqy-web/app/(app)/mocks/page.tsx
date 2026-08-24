"use client";

import { MockPage } from "@/components/mock/mock-page";

export default function MocksRoute() {
  return (
    <main className="flex flex-1 flex-col overflow-hidden" data-testid="mocks-page">
      <MockPage />
    </main>
  );
}

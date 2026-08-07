import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAiSidebarChat } from "@/src/ai/hooks/use-ai-sidebar-chat";

vi.mock("next/navigation", () => ({ usePathname: () => "/test" }));
vi.mock("@/lib/llm-tools", () => ({
  REQLY_TOOLS: [],
  executeToolCall: vi.fn(async () => ({ callId: "c", name: "n", content: "ok" })),
  maskSensitiveObject: (o: unknown) => o,
}));

import { executeToolCall } from "@/lib/llm-tools";

describe("useAiSidebarChat — bug #2 (boucle de confirmation infinie)", () => {
  beforeEach(() => {
    vi.mocked(executeToolCall).mockClear();
  });

  it("A: transmet `confirmed` à executeToolCall pour exécuter l'outil après validation (pas de re-demande infinie)", async () => {
    const { result } = renderHook(() => useAiSidebarChat());
    await act(async () => {
      await result.current.gatedExecute(
        { callId: "c1", name: "delete_collection", arguments: "{}" },
        true,
      );
    });
    const calls = vi.mocked(executeToolCall).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const opts = calls[0][1] as { confirmed?: boolean } | undefined;
    expect(opts?.confirmed).toBe(true);
  });
});

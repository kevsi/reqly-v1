import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useAiSidebarChat } from "@/src/ai/hooks/use-ai-sidebar-chat";
import { streamLLM } from "@/src/ai/cloud-engine/llm";

vi.mock("next/navigation", () => ({ usePathname: () => "/test" }));
vi.mock("@/src/ai/cloud-engine/llm", () => ({
  streamLLM: vi.fn(),
}));
vi.mock("@/lib/llm-tools", () => ({
  REQLY_TOOLS: [],
  executeToolCall: vi.fn(async () => ({ callId: "c", name: "n", content: "ok" })),
  maskSensitiveObject: (o: unknown) => o,
}));

import { executeToolCall } from "@/lib/llm-tools";

describe("useAiSidebarChat — bug #2 (boucle de confirmation infinie)", () => {
  beforeEach(() => {
    vi.mocked(executeToolCall).mockClear();
    vi.mocked(streamLLM).mockReset();
  });

  it("A: transmet `confirmed` à executeToolCall pour exécuter l'outil après validation (pas de re-demande infinie)", async () => {
    const { result } = renderHook(() => useAiSidebarChat());
    await import("@testing-library/react").then(({ act }) =>
      act(async () => {
        await result.current.gatedExecute(
          { callId: "c1", name: "delete_collection", arguments: "{}" },
          true,
        );
      }),
    );
    const calls = vi.mocked(executeToolCall).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const opts = calls[0][1] as { confirmed?: boolean } | undefined;
    expect(opts?.confirmed).toBe(true);
  });

  it("B: ne boucle pas si l'outil redemande confirmation après validation (gardefou anti-boucle)", async () => {
    const { result } = renderHook(() => useAiSidebarChat());
    let streamCalls = 0;
    vi.mocked(streamLLM).mockImplementation(async function* () {
      streamCalls++;
      // 1er tour : un outil destructif → confirmation demandée.
      // Tours suivants : rien (comportement normal du LLM).
      if (streamCalls === 1) {
        yield {
          type: "tool_calls",
          calls: [{ id: "c1", name: "delete_collection", arguments: "{}" }],
        };
      }
    });
    // Pire cas : le handler ignore `confirmed` et redemande TOUJOURS confirmation.
    // Sans gardefou, la boucle tourne indéfiniment → isLoading reste true.
    vi.mocked(executeToolCall).mockImplementation(
      async () =>
        ({
          callId: "c1",
          name: "delete_collection",
          content: "",
          error: "Confirmation requise",
          requireConfirmation: true,
        }) as never,
    );

    const p = result.current.sendMessage("supprime ma collection");
    // On confirme de manière réitérée : le premier appel arrive peut-être
    // avant que le hook ait positionné `confirmResolverRef`, les suivants
    // tombent pendant la fenêtre d'attente, et un d'eux finit par résoudre.
    const timer = setInterval(() => {
      result.current.confirmAction(true);
    }, 50);

    try {
      await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 4000 });
    } finally {
      clearInterval(timer);
    }
  });
});

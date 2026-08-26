import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useAiSidebarChat } from "@/src/ai/hooks/use-ai-sidebar-chat";
import { streamLLM } from "@/src/ai/cloud-engine/llm";

vi.mock("next/navigation", () => ({ usePathname: () => "/test" }));
vi.mock("@/src/ai/cloud-engine/llm", () => ({
  streamLLM: vi.fn(),
}));
// R19 : sendMessage pré-vérifie la configuration IA — fournir une config
// valide pour que ce test continue d'exercer le chemin nominal.
vi.mock("@/lib/config", () => ({
  loadAIProvider: () => "openai",
  loadApiKey: () => "test-key",
  loadAiBaseUrl: () => "",
  loadAiModel: () => "",
  loadOllamaConfig: () => ({}),
}));
vi.mock("@/lib/llm-tools", () => ({
  REQLY_TOOLS: [],
  executeAuthorizedToolCall: vi.fn(async () => ({ callId: "c", name: "n", content: "ok" })),
  getToolTitle: (name: string) => name,
  maskSensitiveObject: (o: unknown) => o,
}));

import { executeAuthorizedToolCall } from "@/lib/llm-tools";

describe("useAiSidebarChat — bug #2 (boucle de confirmation infinie)", () => {
  beforeEach(() => {
    vi.mocked(executeAuthorizedToolCall).mockClear();
    vi.mocked(streamLLM).mockReset();
  });

  it("A: transmet une approbation utilisateur au runtime partagé après validation", async () => {
    const { result } = renderHook(() => useAiSidebarChat());
    await import("@testing-library/react").then(({ act }) =>
      act(async () => {
        await result.current.gatedExecute(
          { callId: "c1", name: "delete_collection", arguments: "{}" },
          "user",
        );
      }),
    );
    const calls = vi.mocked(executeAuthorizedToolCall).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const opts = calls[0][1] as { approval?: string } | undefined;
    expect(opts?.approval).toBe("user");
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
    vi.mocked(executeAuthorizedToolCall).mockImplementation(
      async () =>
        ({
          callId: "c1",
          name: "delete_collection",
          content: "",
          error: "Confirmation requise",
          requireConfirmation: true,
        }) as never,
    );

    void result.current.sendMessage("supprime ma collection");
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

  it("C: les outils en attente de confirmation s'affichent « en attente », pas « erreur »", async () => {
    const { result } = renderHook(() => useAiSidebarChat());
    let streamCalls = 0;
    vi.mocked(streamLLM).mockImplementation(async function* () {
      streamCalls++;
      if (streamCalls === 1) {
        yield {
          type: "tool_calls",
          calls: [
            { id: "c1", name: "delete_collection", arguments: "{}" },
            { id: "c2", name: "create_collection", arguments: "{}" },
          ],
        };
      }
    });
    // Chaque outil « ask » renvoie requireConfirmation sans s'exécuter.
    vi.mocked(executeAuthorizedToolCall).mockImplementation(
      async () =>
        ({
          callId: "c",
          name: "n",
          content: "",
          error: "Confirmation requise",
          requireConfirmation: true,
        }) as never,
    );

    void result.current.sendMessage("fais deux actions");

    // Les DEUX étapes doivent être en attente de confirmation, jamais en erreur
    // (bug : la boucle initiale marquait toutes les confirmations requises en
    // « error », seules la première passait ensuite en awaiting_confirmation).
    await waitFor(() => {
      const last = result.current.messages[result.current.messages.length - 1];
      const steps = last?.steps ?? [];
      expect(steps.filter((s) => s.status === "awaiting_confirmation")).toHaveLength(2);
    });
    const awaitingSteps = result.current.messages[result.current.messages.length - 1]?.steps ?? [];
    expect(awaitingSteps.filter((s) => s.status === "error")).toHaveLength(0);

    // Confirmer la première : elle s'exécute, la boucle se referme (le mock
    // redemande toujours confirmation → garde-fou anti-boucle), isLoading repasse
    // à false sans attente infinie.
    result.current.confirmAction(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 4000 });
  });
});

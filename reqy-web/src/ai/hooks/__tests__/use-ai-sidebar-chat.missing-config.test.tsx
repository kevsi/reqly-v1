import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAiSidebarChat } from "@/src/ai/hooks/use-ai-sidebar-chat";
import { streamLLM } from "@/src/ai/cloud-engine/llm";

vi.mock("next/navigation", () => ({ usePathname: () => "/test" }));
vi.mock("@/src/ai/cloud-engine/llm", () => ({
  streamLLM: vi.fn(),
}));

// Configuration contrôlée par test : `mockedConfigured` bascule la réponse
// d'isAiConfigured (via le mock de @/lib/config) sans réécrire les mocks.
let mockedConfigured = false;
vi.mock("@/lib/ai-config", () => ({
  isAiConfigured: () => mockedConfigured,
}));
vi.mock("@/lib/config", () => ({
  loadAIProvider: () => "openai",
  loadApiKey: () => (mockedConfigured ? "test-key" : ""),
  loadAiBaseUrl: () => "",
  loadAiModel: () => "",
  loadOllamaConfig: () => ({}),
}));
vi.mock("@/lib/llm-tools", () => ({
  REQLY_TOOLS: [],
  executeAuthorizedToolCall: vi.fn(async () => ({ callId: "c", name: "n", content: "ok" })),
  maskSensitiveObject: (o: unknown) => o,
}));

describe("useAiSidebarChat — parcours guidé sans clé IA (R19)", () => {
  beforeEach(() => {
    mockedConfigured = false;
    vi.mocked(streamLLM).mockReset();
  });

  it("sans configuration : bloque l'envoi, pousse missingConfig et n'appelle pas le LLM", async () => {
    const { result } = renderHook(() => useAiSidebarChat());

    await act(async () => {
      await result.current.sendMessage("bonjour");
    });

    expect(result.current.missingConfig).toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    // Aucun message utilisateur poussé, aucun appel LLM lancé.
    expect(result.current.messages).toHaveLength(0);
    expect(vi.mocked(streamLLM)).not.toHaveBeenCalled();
  });

  it("avec une configuration valide : le flux nominal reprend et missingConfig reste faux", async () => {
    mockedConfigured = true;
    vi.mocked(streamLLM).mockImplementation(async function* () {
      yield { type: "text" as const, value: "réponse" };
    });

    const { result } = renderHook(() => useAiSidebarChat());
    void result.current.sendMessage("bonjour");

    await waitFor(() => {
      const last = result.current.messages[result.current.messages.length - 1];
      expect(last?.phase).toBe("done");
      expect(last?.content).toContain("réponse");
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.missingConfig).toBe(false);
    expect(vi.mocked(streamLLM)).toHaveBeenCalled();
  });

  it("clearMessages réinitialise missingConfig", async () => {
    const { result } = renderHook(() => useAiSidebarChat());
    await act(async () => {
      await result.current.sendMessage("bonjour");
    });
    expect(result.current.missingConfig).toBe(true);

    act(() => {
      result.current.clearMessages();
    });
    expect(result.current.missingConfig).toBe(false);
  });
});

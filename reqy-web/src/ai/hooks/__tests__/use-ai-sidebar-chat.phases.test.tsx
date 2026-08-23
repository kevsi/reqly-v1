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
  maskSensitiveObject: (o: unknown) => o,
}));

import { executeAuthorizedToolCall } from "@/lib/llm-tools";

describe("useAiSidebarChat — phases tool_calling → awaiting_response → streaming → done", () => {
  beforeEach(() => {
    vi.mocked(executeAuthorizedToolCall).mockClear();
    vi.mocked(streamLLM).mockReset();
  });

  it("passe par awaiting_response entre la fin des tool calls et le premier token texte", async () => {
    const { result } = renderHook(() => useAiSidebarChat());
    let llmCalls = 0;
    vi.mocked(streamLLM).mockImplementation(async function* () {
      llmCalls++;
      if (llmCalls === 1) {
        // 1er tour : un tool call (permission « allow », exécuté immédiatement).
        yield {
          type: "tool_calls",
          calls: [{ id: "c1", name: "list_collections", arguments: "{}" }],
        };
      } else {
        // 2e tour : la réponse texte arrive avec un léger délai (vrai streaming
        // SSE) — c'est pendant ce délai que l'UI doit montrer « awaiting_response ».
        await new Promise((r) => setTimeout(r, 80));
        yield { type: "text", value: "Voici la réponse." };
      }
    });

    void result.current.sendMessage("liste les collections");

    // Après l'exécution des tool calls, avant le premier token texte : la phase
    // doit être « awaiting_response » avec un contenu encore vide (la bulle
    // affiche alors l'indicateur typing, pas une bulle vide).
    await waitFor(() => {
      const last = result.current.messages[result.current.messages.length - 1];
      expect(last?.phase).toBe("awaiting_response");
    });
    const awaiting = result.current.messages[result.current.messages.length - 1];
    expect(awaiting?.content).toBe("");

    // Le texte arrive : streaming puis done, avec le contenu final en place.
    await waitFor(() => {
      const last = result.current.messages[result.current.messages.length - 1];
      expect(last?.phase).toBe("done");
      expect(last?.content).toContain("Voici la réponse.");
    });
    expect(result.current.isLoading).toBe(false);
  });
});

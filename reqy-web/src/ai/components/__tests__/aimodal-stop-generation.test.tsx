import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { AIModal } from "@/src/ai/components/AIModal";

vi.mock("@/src/ai/cloud-engine/llm", () => ({
  streamLLM: vi.fn(),
}));

// Config valide pour sauter le formulaire inline et aller droit au LLM.
vi.mock("@/lib/config", () => ({
  loadAIProvider: () => "openai",
  saveAIProvider: vi.fn(),
  saveApiKey: vi.fn(),
  loadApiKey: () => "test-key",
  loadAiBaseUrl: () => "",
  loadAiModel: () => "gpt-test",
  loadOllamaConfig: () => ({}),
}));
vi.mock("@/lib/ai-config", () => ({
  isAiConfigured: () => true,
  resolveAiConfig: () => ({
    provider: "openai",
    apiKey: "test-key",
    model: "gpt-test",
  }),
}));

import { streamLLM } from "@/src/ai/cloud-engine/llm";

/** Stream qui attend l'abort : simule une génération longue interrompable. */
function hangingStream(signal?: AbortSignal) {
  return async function* () {
    yield { type: "text" as const, value: "Début" };
    await new Promise<void>((_resolve, reject) => {
      if (signal?.aborted) reject(abortError());
      signal?.addEventListener("abort", () => reject(abortError()), { once: true });
    });
  };
}

function abortError() {
  const e = new Error("The operation was aborted");
  e.name = "AbortError";
  return e;
}

describe("AIModal — génération interrompable (R17)", () => {
  beforeEach(() => {
    vi.mocked(streamLLM).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  function renderModal() {
    return render(
      <AIModal
        open
        onOpenChange={() => {}}
        method="GET"
        url="https://example.test/api"
        responseStatus={200}
        responseBody='{"ok":true}'
      />,
    );
  }

  it("affiche un bouton Stop pendant la génération ; cliquer aborte le stream", async () => {
    let capturedSignal: AbortSignal | undefined;
    vi.mocked(streamLLM).mockImplementation((opts: { signal?: AbortSignal }) => {
      capturedSignal = opts.signal;
      return hangingStream(opts.signal)();
    });

    renderModal();

    // Ouvrir l'onglet Assistant puis lancer la génération.
    fireEvent.click(screen.getByTestId("ai-tab-assistant"));
    fireEvent.click(screen.getByTestId("ai-run-llm"));

    // Pendant llmLoading : bouton Stop visible, bouton Run absent.
    const stop = await screen.findByTestId("ai-stop-generation");
    expect(screen.queryByTestId("ai-run-llm")).toBeNull();

    fireEvent.click(stop);

    await waitFor(() => expect(screen.getByTestId("ai-run-llm")).toBeTruthy());
    expect(capturedSignal?.aborted).toBe(true);
    // Le texte partiel reste affiché, sans erreur parasite.
    await waitFor(() => expect(screen.queryByTestId("ai-stop-generation")).toBeNull());
    // Le texte partiel reste affiché, sans erreur parasite.
    expect(screen.queryByText(/Proxy error/)).toBeNull();
    expect(screen.getByText(/Début/)).toBeTruthy();
  });

  it("fermer le modal aborte la génération en cours", async () => {
    let capturedSignal: AbortSignal | undefined;
    vi.mocked(streamLLM).mockImplementation((opts: { signal?: AbortSignal }) => {
      capturedSignal = opts.signal;
      return hangingStream(opts.signal)();
    });

    const { rerender } = render(
      <AIModal
        open
        onOpenChange={() => {}}
        method="GET"
        url="https://example.test/api"
        responseStatus={200}
        responseBody='{"ok":true}'
      />,
    );

    fireEvent.click(screen.getByTestId("ai-tab-assistant"));
    fireEvent.click(screen.getByTestId("ai-run-llm"));
    await screen.findByTestId("ai-stop-generation");

    rerender(
      <AIModal
        open={false}
        onOpenChange={() => {}}
        method="GET"
        url="https://example.test/api"
        responseStatus={200}
        responseBody='{"ok":true}'
      />,
    );

    await waitFor(() => expect(capturedSignal?.aborted).toBe(true));
  });

  it("récouvrir le modal efface l'erreur de la session précédente", async () => {
    // Le stream échoue immédiatement → llmError affiché.
    vi.mocked(streamLLM).mockImplementation(() => {
      throw new Error("Proxy error 500");
    });

    const { rerender } = render(
      <AIModal
        open
        onOpenChange={() => {}}
        method="GET"
        url="https://example.test/api"
        responseStatus={200}
        responseBody='{"ok":true}'
      />,
    );

    fireEvent.click(screen.getByTestId("ai-tab-assistant"));
    fireEvent.click(screen.getByTestId("ai-run-llm"));
    await screen.findByText(/Proxy error 500/);

    // Fermer puis rouvrir : l'erreur ne doit plus s'afficher.
    rerender(
      <AIModal
        open={false}
        onOpenChange={() => {}}
        method="GET"
        url="https://example.test/api"
        responseStatus={200}
        responseBody='{"ok":true}'
      />,
    );
    rerender(
      <AIModal
        open
        onOpenChange={() => {}}
        method="GET"
        url="https://example.test/api"
        responseStatus={200}
        responseBody='{"ok":true}'
      />,
    );

    expect(screen.queryByText(/Proxy error 500/)).toBeNull();
  });
});

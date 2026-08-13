import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { ProgressiveMarkdown } from "@/src/ai/components/progressive-markdown";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ProgressiveMarkdown", () => {
  it("affiche tout immédiatement quand le contenu est déjà complet au montage (historique, commande…)", () => {
    const { container } = render(<ProgressiveMarkdown content="Bonjour le monde" />);
    expect(container.textContent).toContain("Bonjour le monde");
  });

  it("révèle le texte mot à mot quand la réponse arrive après le montage (streaming)", () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<ProgressiveMarkdown content="" />);

    // La réponse arrive d'un bloc (Ollama, Anthropic, Tauri…).
    rerender(<ProgressiveMarkdown content="Bonjour le monde test" />);

    // Aucun mot n'est encore visible tant que la boucle de révélation n'a pas tourné.
    expect(container.textContent).not.toContain("Bonjour");

    // Premier tick → premier mot.
    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(container.textContent).toContain("Bonjour");
    expect(container.textContent).not.toContain("monde");

    // Suffisamment de ticks → tout le texte est révélé.
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(container.textContent).toContain("Bonjour le monde test");
  });

  it("ne révèle rien tant que le contenu est vide", () => {
    vi.useFakeTimers();
    const { container } = render(<ProgressiveMarkdown content="" />);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(container.textContent ?? "").toBe("");
  });

  it("appelle onTextChange à chaque évolution du texte révélé", () => {
    vi.useFakeTimers();
    const onTextChange = vi.fn();
    const { rerender } = render(<ProgressiveMarkdown content="" onTextChange={onTextChange} />);
    rerender(<ProgressiveMarkdown content="un deux trois" onTextChange={onTextChange} />);

    expect(onTextChange).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onTextChange).toHaveBeenCalled();
  });
});

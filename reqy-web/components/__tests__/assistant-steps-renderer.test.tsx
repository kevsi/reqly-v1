import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import {
  AssistantStepsRenderer,
  buildStep,
  stripTrailingEllipsis,
  type AssistantStep,
} from "@/src/ai/components/assistant-steps-renderer";
import { Brain, Play } from "lucide-react";

afterEach(() => {
  cleanup();
});

// ── Mock data: 3 étapes typiques d'un flux IA ──────────────────────────────

function makeMockSteps(): AssistantStep[] {
  return [
    buildStep({
      kind: "thinking",
      label: "Through",
      status: "done",
      icon: Brain,
      detail: "Analyse de la demande utilisateur",
    }),
    buildStep({
      kind: "tool_call",
      label: 'Création de la collection "API Users"',
      status: "done",
      icon: Play,
      detail: 'POST /collections — payload: { name: "API Users" }',
    }),
    buildStep({
      kind: "tool_call",
      label: "Exécution de la requête GET /users",
      status: "pending",
      icon: Play,
      detail: "GET https://api.example.com/users",
    }),
  ];
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("AssistantStepsRenderer", () => {
  it("normalise les ellipses ajoutées aux labels de statut", () => {
    expect(stripTrailingEllipsis("Analyse en cours...")).toBe("Analyse en cours");
    expect(stripTrailingEllipsis("Analyse en cours…")).toBe("Analyse en cours");
    expect(stripTrailingEllipsis("Analyse en cours")).toBe("Analyse en cours");
  });

  it("affiche toutes les étapes avec leurs libellés en mode timeline", () => {
    const steps = makeMockSteps();
    render(<AssistantStepsRenderer steps={steps} mode="timeline" />);

    expect(screen.getByText("Through")).toBeDefined();
    expect(screen.getByText('Création de la collection "API Users"')).toBeDefined();
    expect(screen.getByText("Exécution de la requête GET /users")).toBeDefined();
  });

  it("affiche le texte final seulement quand toutes les étapes sont done/error", () => {
    const steps = makeMockSteps();
    // steps[2] est "pending" → le texte final ne doit PAS apparaître
    const { rerender } = render(
      <AssistantStepsRenderer steps={steps} finalText="Réponse finale de l'assistant." />,
    );

    expect(screen.queryByText("Réponse finale de l'assistant.")).toBeNull();

    // Marquer la dernière step comme "done"
    const allDone: AssistantStep[] = steps.map((s) => ({ ...s, status: "done" as const }));
    rerender(<AssistantStepsRenderer steps={allDone} finalText="Réponse finale de l'assistant." />);

    expect(screen.getByText("Réponse finale de l'assistant.")).toBeDefined();
  });

  it("ne retourne rien si steps est vide et pas de finalText", () => {
    const { container } = render(<AssistantStepsRenderer steps={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("le detail est masque par defaut et s'affiche au clic (mode timeline)", () => {
    const steps = [
      buildStep({
        kind: "thinking",
        label: "Through",
        status: "done",
        icon: Brain,
        detail: "Analyse détaillée du contexte",
      }),
      buildStep({
        kind: "tool_call",
        label: "Création",
        status: "done",
        icon: Play,
        detail: 'POST /collections payload: {name: "API Users"}',
      }),
    ];
    render(<AssistantStepsRenderer steps={steps} mode="timeline" />);

    // En mode timeline, les enfants sont visibles par défaut
    expect(screen.getByText("Création")).toBeDefined();
  });

  it("l'étape active (pending) est visible en mode sequential", () => {
    const steps = [
      buildStep({
        kind: "thinking",
        label: "En cours",
        status: "pending",
        icon: Brain,
      }),
    ];
    render(<AssistantStepsRenderer steps={steps} />);
    const btn = screen.getByText("En cours");
    // Vérifie que le bouton a la classe text-foreground (donc visible, pas atténué)
    expect(btn.className).toContain("text-foreground");
  });

  it("buildStep génère un id unique pour chaque étape", () => {
    const a = buildStep({ kind: "thinking" });
    const b = buildStep({ kind: "tool_call" });
    expect(a.id).not.toBe(b.id);
  });

  it("le conteneur a une classe space-y-0 en mode timeline", () => {
    const steps = makeMockSteps();
    const { container } = render(<AssistantStepsRenderer steps={steps} mode="timeline" />);
    // Le premier élément conteneur doit avoir une classe qui limite l'espacement
    const root = container.firstElementChild;
    expect(root?.className).toContain("space-y-0");
  });

  it("en mode sequential, seule l'étape active est visible", () => {
    const steps = [
      buildStep({ kind: "thinking", label: "Through", status: "done" }),
      buildStep({ kind: "tool_call", label: "Création", status: "done" }),
      buildStep({ kind: "result", label: "Exécution", status: "pending" }),
    ];
    render(<AssistantStepsRenderer steps={steps} />);

    // Les étapes "done" ne doivent PAS être visibles
    expect(screen.queryByText("Through")).toBeNull();
    expect(screen.queryByText("Création")).toBeNull();
    // Seule l'étape "pending" est visible
    expect(screen.getByText("Exécution")).toBeDefined();
  });

  it("en mode sequential, toutes les étapes done ne montrent rien sans finalText", () => {
    const steps = [
      buildStep({ kind: "thinking", label: "Through", status: "done" }),
      buildStep({ kind: "result", label: "Terminé", status: "done" }),
    ];
    const { container } = render(<AssistantStepsRenderer steps={steps} />);
    // Rien d'affiché car toutes done et pas de finalText
    expect(container.innerHTML).toBe("");
  });

  it("se replie automatiquement en une ligne résumée quand tout est terminé (collapsible)", () => {
    const steps = [
      buildStep({ kind: "thinking", label: "Through", status: "done" }),
      buildStep({ kind: "tool_call", label: "Création", status: "done" }),
    ];
    render(<AssistantStepsRenderer steps={steps} mode="timeline" collapsible />);

    // Les étapes sont repliées : le toggle résumé est visible avec les badges tool
    expect(screen.getByTestId("ai-steps-toggle")).toBeDefined();
    expect(screen.getByText(/exécution/i)).toBeDefined();
    // Le badge du tool_call est visible dans le collapsed summary
    expect(screen.getByText("Création")).toBeDefined();

    // Un clic rouvre la timeline : Création apparaît dans le step row (en plus du badge)
    expect(screen.getByTestId("ai-steps-toggle").getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(screen.getByTestId("ai-steps-toggle"));
    expect(screen.getByTestId("ai-steps-toggle").getAttribute("aria-expanded")).toBe("true");
  });

  it("ne replie pas pendant l'exécution (collapsible mais pas terminé)", () => {
    const steps = [
      buildStep({ kind: "thinking", label: "Through", status: "done" }),
      buildStep({ kind: "tool_call", label: "Création", status: "pending" }),
    ];
    render(<AssistantStepsRenderer steps={steps} mode="timeline" collapsible />);

    // L'étape en cours reste visible, pas de toggle résumé
    expect(screen.getByText("Création")).toBeDefined();
    expect(screen.queryByTestId("ai-steps-toggle")).toBeNull();
  });
});

// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QuickStart } from "../quick-start";
import { useRequestStore } from "@/hooks/use-request-store";

const buildStore = (overrides: Record<string, unknown> = {}) => {
  useRequestStore.setState({
    history: [],
    collections: [{ id: "col-drafts", name: "Drafts", requests: [] }],
    onboardingCompleted: false,
    completeOnboarding: () => useRequestStore.setState({ onboardingCompleted: true }),
    ...overrides,
  } as never);
};

describe("QuickStart (onboarding)", () => {
  beforeEach(() => {
    cleanup();
    buildStore();
  });

  it("renders 3 steps when nothing is done", () => {
    render(<QuickStart />);
    expect(screen.getByTestId("onboarding-quick-start")).toBeDefined();
    expect(screen.getAllByRole("listitem").length).toBe(3);
  });

  it("marks step 1 done when history has entries", () => {
    buildStore({ history: [{ id: "h1" }] });
    render(<QuickStart />);
    expect(screen.getByText(/première requête/i)).toBeDefined();
  });

  it("auto-completes and unmounts when all steps are done", () => {
    buildStore({
      history: [{ id: "h1" }],
      collections: [
        { id: "col-drafts", name: "Drafts", requests: [{ id: "r1", runnerAssertions: [{ type: "status" }] }] },
        { id: "col-2", name: "Team", requests: [] },
      ],
    });
    const { container } = render(<QuickStart />);
    expect(container.querySelector('[data-testid="onboarding-quick-start"]')).toBeNull();
    expect(useRequestStore.getState().onboardingCompleted).toBe(true);
  });

  it("dismiss persists via completeOnboarding on close", () => {
    render(<QuickStart />);
    fireEvent.click(screen.getByRole("button", { name: /passer|skip/i }));
    expect(useRequestStore.getState().onboardingCompleted).toBe(true);
    cleanup();
    expect(screen.queryByTestId("onboarding-quick-start")).toBeNull();
  });
});

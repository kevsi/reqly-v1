import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { useSessionStore } from "@/lib/session-store";
import { SyncSignedOutBanner } from "@/components/sync-signed-out-banner";

beforeEach(() => {
  localStorage.clear();
  useSessionStore.setState({ user: null, token: null, status: "unauthenticated" });
});

afterEach(() => {
  cleanup();
});

describe("SyncSignedOutBanner", () => {
  it("prompts sign-in to sync when not authenticated", () => {
    render(<SyncSignedOutBanner />);
    expect(screen.getByTestId("sync-signed-out")).toBeTruthy();
    expect(screen.getByText(/connecte-toi pour synchroniser/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /se connecter/i }).getAttribute("href")).toBe("/login");
    expect(screen.getByRole("link", { name: /créer un compte/i }).getAttribute("href")).toBe(
      "/signup",
    );
  });

  it("renders nothing when authenticated", () => {
    useSessionStore.setState({
      user: { id: "u1", email: "alice@test.io", name: "Alice" },
      token: "tok",
      status: "authenticated",
    });
    const { container } = render(<SyncSignedOutBanner />);
    expect(container.querySelector('[data-testid="sync-signed-out"]')).toBeNull();
  });
});

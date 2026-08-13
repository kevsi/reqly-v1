import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import i18n from "@/src/i18n";
import { useSessionStore } from "@/lib/session-store";
import { SyncSignedOutBanner } from "@/components/sync-signed-out-banner";

beforeEach(async () => {
  localStorage.clear();
  useSessionStore.setState({ user: null, token: null, status: "unauthenticated" });
  await i18n.changeLanguage("en");
});

afterEach(async () => {
  cleanup();
  // Restore the default language: i18next is a module singleton, so leaving
  // it on "en" would leak into every other test that renders translated UI.
  await i18n.changeLanguage("fr");
});

describe("SyncSignedOutBanner", () => {
  it("prompts sign-in to sync when not authenticated", () => {
    render(<SyncSignedOutBanner />);
    expect(screen.getByTestId("sync-signed-out")).toBeTruthy();
    expect(screen.getByText(/sign in to sync/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /sign in/i }).getAttribute("href")).toBe("/login");
    expect(screen.getByRole("link", { name: /create an account/i }).getAttribute("href")).toBe(
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

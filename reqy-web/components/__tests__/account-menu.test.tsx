import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const { authSignup, authLogin, authLogout, authMe } = vi.hoisted(() => ({
  authSignup: vi.fn(),
  authLogin: vi.fn(),
  authLogout: vi.fn().mockResolvedValue(undefined),
  authMe: vi.fn(),
}));
vi.mock("@/lib/auth-client", () => ({ authSignup, authLogin, authLogout, authMe }));

import { useSessionStore } from "@/lib/session-store";
import { AccountMenu } from "@/components/account-menu";

beforeEach(() => {
  localStorage.clear();
  authLogout.mockClear();
  useSessionStore.setState({ user: null, token: null, status: "unauthenticated" });
});

afterEach(() => {
  cleanup();
});

describe("AccountMenu", () => {
  it("shows a 'Se connecter' link when unauthenticated", () => {
    const { getByRole } = render(<AccountMenu />);
    const link = getByRole("link", { name: /se connecter/i });
    expect(link.getAttribute("href")).toBe("/login");
  });

  it("shows the user's email and logs out when authenticated", async () => {
    useSessionStore.setState({
      user: { id: "u1", email: "alice@test.io", name: "Alice" },
      token: "tok",
      status: "authenticated",
    });
    const { getByTestId } = render(<AccountMenu />);
    // Radix DropdownMenu opens on pointerdown (mouse). fireEvent.click alone
    // does not trigger it in jsdom.
    fireEvent.pointerDown(getByTestId("account-trigger"), { pointerType: "mouse", button: 0 });
    // The menu content is portaled to document.body, so query via screen.
    expect(screen.getByText("alice@test.io")).toBeTruthy();

    fireEvent.click(screen.getByRole("menuitem", { name: /se déconnecter/i }));
    await waitFor(() => {
      expect(authLogout).toHaveBeenCalledWith("tok");
    });
    await waitFor(() => {
      expect(useSessionStore.getState().token).toBeNull();
      expect(useSessionStore.getState().status).toBe("unauthenticated");
    });
  });
});

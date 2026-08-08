import { describe, it, expect, vi, beforeEach } from "vitest";

const { authSignup, authLogin, authLogout, authMe } = vi.hoisted(() => ({
  authSignup: vi.fn(),
  authLogin: vi.fn(),
  authLogout: vi.fn(),
  authMe: vi.fn(),
}));
vi.mock("@/lib/auth-client", () => ({ authSignup, authLogin, authLogout, authMe }));

import { useSessionStore } from "@/lib/session-store";

beforeEach(() => {
  localStorage.clear();
  authSignup.mockReset();
  authLogin.mockReset();
  authLogout.mockReset();
  authMe.mockReset();
  useSessionStore.setState({ user: null, token: null, status: "unauthenticated" });
});

describe("session-store", () => {
  it("login sets user+token, marks authenticated (memory-only, no localStorage)", async () => {
    authLogin.mockResolvedValue({ user: { id: "u1", email: "a@b.io", name: "A" }, token: "tok" });
    const user = await useSessionStore.getState().login("a@b.io", "supersecret");
    expect(user.email).toBe("a@b.io");
    expect(useSessionStore.getState().token).toBe("tok");
    expect(useSessionStore.getState().status).toBe("authenticated");
  });

  it("signup sets user+token and marks authenticated", async () => {
    authSignup.mockResolvedValue({ user: { id: "u1", email: "a@b.io", name: "" }, token: "tok" });
    await useSessionStore.getState().signup("a@b.io", "supersecret", "A");
    expect(useSessionStore.getState().token).toBe("tok");
    expect(useSessionStore.getState().status).toBe("authenticated");
  });

  it("signup without user/token (backend only returns { userId, email }) does not crash and stays unauthenticated", async () => {
    authSignup.mockResolvedValue({ user: undefined, token: undefined });
    const res = await useSessionStore.getState().signup("a@b.io", "supersecret", "");
    expect(res).toEqual({ userId: "", email: "a@b.io", message: "" });
    expect(useSessionStore.getState().token).toBeNull();
    expect(useSessionStore.getState().status).toBe("unauthenticated");
  });

  it("restore sets unauthenticated (memory-only, no token validation)", async () => {
    useSessionStore.setState({ token: "tok", status: "loading" });
    await useSessionStore.getState().restore();
    expect(authMe).not.toHaveBeenCalled();
    expect(useSessionStore.getState().token).toBeNull();
    expect(useSessionStore.getState().status).toBe("unauthenticated");
  });

  it("logout calls authLogout and clears the token from memory", async () => {
    useSessionStore.setState({
      token: "tok",
      user: { id: "u1", email: "a@b.io", name: "A" },
      status: "authenticated",
    });
    authLogout.mockResolvedValue(undefined);
    await useSessionStore.getState().logout();
    expect(authLogout).toHaveBeenCalledWith("tok");
    expect(useSessionStore.getState().token).toBeNull();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { authMe, authSignup, authLogin } from "@/lib/auth-client";

describe("auth-client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("authMe unwraps the `user` field from the /me response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ user: { id: "u1", email: "a@b.c", name: "Tester" } }),
      }),
    );
    const user = await authMe("token");
    expect(user).toEqual({ id: "u1", email: "a@b.c", name: "Tester" });
  });

  it("authSignup returns the parsed user and token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          user: { id: "u2", email: "s@b.c", name: "S" },
          token: "tok",
        }),
      }),
    );
    const result = await authSignup("s@b.c", "password123");
    expect(result.user.email).toBe("s@b.c");
    expect(result.token).toBe("tok");
  });

  it("authLogin returns the parsed user and token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          user: { id: "u3", email: "l@b.c", name: "L" },
          token: "tok2",
        }),
      }),
    );
    const result = await authLogin("l@b.c", "password123");
    expect(result.user.email).toBe("l@b.c");
    expect(result.token).toBe("tok2");
  });
});

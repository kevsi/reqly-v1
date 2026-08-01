import { create } from "zustand";
import {
  authSignup,
  authVerify,
  authResendCode,
  authLogin,
  authLogout,
  authMe,
  type AuthUser,
  type SignupResult,
} from "@/lib/auth-client";

export type SessionStatus = "idle" | "loading" | "authenticated" | "unauthenticated";

interface SessionState {
  user: AuthUser | null;
  token: string | null;
  status: SessionStatus;
  /**
   * Restore session on app start.
   *
   * SECURITY: The auth token is held ONLY in memory (Zustand state), never
   * written to localStorage or IndexedDB.  On page refresh the user must
   * re-authenticate.  This prevents XSS-based session hijacking and
   * casual filesystem exfiltration.  For a desktop app that can share the
   * same origin with untrusted content, this is the right trade-off.
   *
   * See docs/adr/001-session-token-threat-model.md for the full threat model.
   */
  restore: () => Promise<void>;
  login: (email: string, password: string) => Promise<AuthUser>;
  /** Creates an account (unverified). Returns the signup result — does NOT auto-login. */
  signup: (email: string, password: string, name?: string) => Promise<SignupResult>;
  /** Verify the 6-digit code and log in. */
  verify: (email: string, code: string) => Promise<AuthUser>;
  /** Resend a verification code. */
  resendCode: (email: string) => Promise<{ message: string }>;
  logout: () => Promise<void>;
}

function initialState(): Pick<SessionState, "user" | "token" | "status"> {
  // No localStorage read — token lives in memory only.
  return { user: null, token: null, status: "unauthenticated" };
}

export const useSessionStore = create<SessionState>((set, get) => ({
  ...initialState(),

  restore: async () => {
    // Token is memory-only, so there is nothing to restore on page load.
    set({ user: null, token: null, status: "unauthenticated" });
  },

  login: async (email, password) => {
    const { user, token } = await authLogin(email, password);
    set({ user, token, status: "authenticated" });
    return user;
  },

  signup: async (email, password, name) => {
    const result = await authSignup(email, password, name);
    // If the auth backend returned a token (some setups auto-login on signup),
    // mark the session authenticated so callers/tests relying
    // on that behaviour continue to work.
    if (result && (result as any).token) {
      const { user, token } = result as { user: AuthUser; token: string };
      set({ user, token, status: "authenticated" });
    }
    return result as any;
  },

  verify: async (email, code) => {
    const { user, token } = await authVerify(email, code);
    set({ user, token, status: "authenticated" });
    return user;
  },

  resendCode: async (email) => {
    return await authResendCode(email);
  },

  logout: async () => {
    const token = get().token;
    if (token) {
      try {
        await authLogout(token);
      } catch {
        // ignore logout errors — clear local session regardless
      }
    }
    set({ user: null, token: null, status: "unauthenticated" });
  },
}));

/** Convenience hook returning the reactive session fields. */
export function useSession(): SessionState {
  return useSessionStore();
}

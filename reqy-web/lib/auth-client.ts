import { getPublicEnv } from "@/lib/env";

/**
 * Client-side auth API.
 *
 * Talks directly to the sync backend's `/api/auth/*` routes (same host the
 * rest of the app reaches via `NEXT_PUBLIC_SYNC_URL`). On success, `signup`
 * and `login` return a session token; callers are expected to persist it and
 * send it back as a `Bearer` token (the sync backend's `requireAuth` accepts
 * either the session cookie or a Bearer token).
 */

const AUTH_PATH = "/api/auth";

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
}

export interface AuthResult {
  user: AuthUser;
  token: string;
}

export interface SignupResult {
  userId: string;
  email: string;
  message: string;
}

export interface LoginError {
  error: string;
  needsVerification?: boolean;
  email?: string;
}

function authBaseUrl(): string {
  return (getPublicEnv().NEXT_PUBLIC_SYNC_URL || "").replace(/\/$/, "");
}

async function postJson(
  path: string,
  body: unknown,
  token?: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${authBaseUrl()}${AUTH_PATH}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    credentials: "include",
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    // Propagate the full error object so callers can read needsVerification etc.
    const err = new Error(
      (data?.error as string) || `Auth request failed: ${res.status}`,
    ) as Error & {
      status: number;
      needsVerification?: boolean;
      email?: string;
      attemptsRemaining?: number;
      codeInvalidated?: boolean;
    };
    err.status = res.status;
    if (data?.needsVerification) {
      err.needsVerification = true;
      err.email = data.email as string;
    }
    if (typeof data?.attemptsRemaining === "number") {
      err.attemptsRemaining = data.attemptsRemaining;
    }
    if (data?.codeInvalidated) {
      err.codeInvalidated = true;
    }
    throw err;
  }
  return data;
}

export async function authSignup(
  email: string,
  password: string,
  name?: string,
): Promise<AuthResult> {
  const data = await postJson("/signup", { email, password, name });
  return { user: data.user as AuthUser, token: data.token as string };
}

export async function authVerify(email: string, code: string): Promise<AuthResult> {
  const data = await postJson("/verify", { email, code });
  return { user: data.user as AuthUser, token: data.token as string };
}

export async function authResendCode(email: string): Promise<{ message: string }> {
  const data = await postJson("/resend-code", { email });
  return { message: data.message as string };
}

// Alias for convenience
export const resendVerificationCode = authResendCode;

export async function authLogin(email: string, password: string): Promise<AuthResult> {
  const data = await postJson("/login", { email, password });
  return { user: data.user as AuthUser, token: data.token as string };
}

export async function authLogout(token: string): Promise<void> {
  await postJson("/logout", {}, token);
}

export async function authMe(token: string): Promise<AuthUser> {
  const res = await fetch(`${authBaseUrl()}${AUTH_PATH}/me`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`Not authenticated: ${res.status}`);
  }
  const data = (await res.json()) as { user: AuthUser };
  return data.user;
}

export async function authForgotPassword(email: string): Promise<{ message: string }> {
  const data = await postJson("/forgot-password", { email });
  return { message: data.message as string };
}

export async function authResetPassword(
  email: string,
  code: string,
  newPassword: string,
): Promise<{ message: string }> {
  const data = await postJson("/reset-password", { email, code, newPassword });
  return { message: data.message as string };
}

/**
 * Two-step reset flow, step 1: validate the reset code WITHOUT consuming it.
 * The actual password change still goes through /reset-password (step 2),
 * which enforces expiry + attempt cap again server-side.
 */
export async function authVerifyResetCode(
  email: string,
  code: string,
): Promise<{ valid: boolean }> {
  const data = await postJson("/verify-reset-code", { email, code });
  return { valid: data.valid === true };
}

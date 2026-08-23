import { NextRequest } from "next/server";

const AUTH_TIMEOUT_MS = 5000;

/** Resolve the authenticated sync user for capture API ownership. */
export async function requireCaptureUserId(request: NextRequest): Promise<string> {
  const authorization = request.headers.get("authorization");
  const cookie = request.cookies.get("auth_session")?.value;
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1] ?? cookie;

  if (!token) {
    throw new CaptureAuthError("Authentication required", 401);
  }

  const syncUrl = process.env.NEXT_PUBLIC_SYNC_URL?.replace(/\/$/, "");
  if (!syncUrl) {
    throw new CaptureAuthError("Authentication service unavailable", 503);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);
  try {
    const response = await fetch(`${syncUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw new CaptureAuthError("Authentication required", 401);
    const payload = (await response.json()) as { user?: { id?: string } };
    const userId = payload.user?.id;
    if (!userId) throw new CaptureAuthError("Authentication required", 401);
    return userId;
  } catch (error) {
    if (error instanceof CaptureAuthError) throw error;
    throw new CaptureAuthError("Authentication service unavailable", 503);
  } finally {
    clearTimeout(timeout);
  }
}

export class CaptureAuthError extends Error {
  constructor(
    message: string,
    public readonly status: 401 | 503,
  ) {
    super(message);
    this.name = "CaptureAuthError";
  }
}

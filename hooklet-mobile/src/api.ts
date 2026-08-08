// API client for the Hooklet backend on sync-server.
// Auth is via signed session tokens: login/verify return a token that is then
// sent as `Authorization: Bearer` on every call.

import type { AuthSession, Device, Endpoint, WebhookEvent } from "./types";

const API_TIMEOUT_MS = 20_000;

async function request<T>(
  baseUrl: string,
  path: string,
  opts: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
      method: opts.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => ({}))) as T & {
      error?: string;
      needsVerification?: boolean;
    };
    if (!res.ok) {
      const err = new Error(data.error ?? `HTTP ${res.status}`) as Error & {
        needsVerification?: boolean;
      };
      if (data.needsVerification) err.needsVerification = true;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

// ── Auth (sync-server /api/auth) ───────────────────────────────────────────

export function signin(baseUrl: string, email: string, password: string) {
  return request<AuthSession>(baseUrl, "/api/auth/login", {
    method: "POST",
    body: { email, password },
  });
}

export function getMe(baseUrl: string, token: string) {
  return request<{ user: AuthSession["user"] }>(baseUrl, "/api/auth/me", {
    token,
  }).then((d) => d.user);
}

export function signup(baseUrl: string, email: string, password: string, name?: string) {
  return request<{ userId: string; email: string; message: string }>(baseUrl, "/api/auth/signup", {
    method: "POST",
    body: { email, password, name },
  });
}

export function verify(baseUrl: string, email: string, code: string) {
  return request<AuthSession>(baseUrl, "/api/auth/verify", {
    method: "POST",
    body: { email, code },
  });
}

export function resendCode(baseUrl: string, email: string) {
  return request<{ message: string }>(baseUrl, "/api/auth/resend-code", {
    method: "POST",
    body: { email },
  });
}

// ── Endpoints ───────────────────────────────────────────────────────────────

export function fetchEndpoints(baseUrl: string, token: string) {
  return request<{ endpoints: Endpoint[] }>(baseUrl, "/api/hooklet/endpoints", {
    token,
  }).then((d) => d.endpoints);
}

export function createEndpoint(baseUrl: string, token: string, name: string, withSecret: boolean) {
  return request<{ endpoint: Endpoint }>(baseUrl, "/api/hooklet/endpoints", {
    method: "POST",
    token,
    body: { name, withSecret },
  }).then((d) => d.endpoint);
}

export function toggleNotify(baseUrl: string, token: string, id: number, notify: boolean) {
  return request<{ success: boolean }>(baseUrl, `/api/hooklet/endpoints/${id}/notify`, {
    method: "POST",
    token,
    body: { notify },
  });
}

export function deleteEndpoint(baseUrl: string, token: string, id: number) {
  return request<{ success: boolean }>(baseUrl, `/api/hooklet/endpoints/${id}`, {
    method: "DELETE",
    token,
  });
}

/** Build the public ingest URL a service should POST webhooks to. */
export function endpointUrl(baseUrl: string, slug: string) {
  return `${baseUrl.replace(/\/$/, "")}/api/hooks/${slug}`;
}

// ── Events ──────────────────────────────────────────────────────────────────

export function fetchEvents(baseUrl: string, token: string, endpointId?: number) {
  const qs = endpointId ? `?endpointId=${endpointId}` : "";
  return request<{ events: WebhookEvent[] }>(baseUrl, `/api/hooklet/events${qs}`, {
    token,
  }).then((d) => d.events);
}

export function deleteEvent(baseUrl: string, token: string, id: number) {
  return request<{ success: boolean }>(baseUrl, `/api/hooklet/events/${id}`, {
    method: "DELETE",
    token,
  });
}

export function replayEvent(baseUrl: string, token: string, id: number) {
  return request<{ success: boolean; id: number }>(baseUrl, `/api/hooklet/events/${id}/replay`, {
    method: "POST",
    token,
  });
}

// ── Devices ─────────────────────────────────────────────────────────────────

export function fetchDevices(baseUrl: string, token: string) {
  return request<{ devices: Device[] }>(baseUrl, "/api/hooklet/devices", {
    token,
  }).then((d) => d.devices);
}

export function registerDevice(
  baseUrl: string,
  token: string,
  expoPushToken: string,
  platform: string,
  deviceName: string,
) {
  return request<{ ok: boolean; id?: number }>(baseUrl, "/api/hooklet/devices", {
    method: "POST",
    token,
    body: { expoPushToken, platform, deviceName },
  });
}

export function unregisterDevice(baseUrl: string, token: string, expoPushToken: string) {
  return request<{ ok: boolean }>(
    baseUrl,
    `/api/hooklet/devices?token=${encodeURIComponent(expoPushToken)}`,
    { method: "DELETE", token },
  );
}

export function sendTestPush(baseUrl: string, token: string) {
  return request<{ count: number }>(baseUrl, "/api/hooklet/devices/test", {
    method: "POST",
    token,
  });
}

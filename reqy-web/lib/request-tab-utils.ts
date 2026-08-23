// ── Utilitaires pour les onglets de requête ──────────────────────────────

import type { Header, RequestTab } from "@/lib/request-executor";

export const STORAGE_KEY_TABS = "reqly-request-tabs";

export function generateRequestTabId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export function headersArrayToRecord(headers: Header[]): Record<string, string> {
  return Object.fromEntries(
    headers
      .filter((header) => header.key?.trim() && header.value?.trim())
      .map((header) => [header.key.trim(), header.value.trim()]),
  );
}

export function recordToHeaderArray(headers?: Record<string, string>): Header[] {
  return headers ? Object.entries(headers).map(([key, value]) => ({ key, value })) : [];
}

export function sanitizeTabForStorage(tab: RequestTab) {
  const {
    responseData: _responseData,
    testResults: _testResults,
    authToken: _authToken,
    headers,
    ...rest
  } = tab;
  void _responseData;
  void _testResults;
  void _authToken;
  return {
    ...rest,
    // Strip credentials before persisting (matches sanitizeStore in hooks/store/persistence.ts)
    headers: (headers ?? []).filter(
      (h) => !/^authorization$/i.test(h.key) && !/^x-api-key$/i.test(h.key),
    ),
  };
}

export function createEmptyTab(overrides: Partial<RequestTab> = {}): RequestTab {
  return {
    id: generateRequestTabId(),
    name: "New Request",
    method: "GET",
    url: "",
    endpoint: "",
    headers: [] as Header[],
    queryParams: [],
    pathParams: [],
    body: "",
    bodyType: "json",
    authType: "none",
    authToken: "",
    followRedirects: false,
    hasResponse: false,
    isSaved: false,
    ...overrides,
  };
}

export const initialTabs: RequestTab[] = [createEmptyTab({ id: "1", name: "New Request" })];

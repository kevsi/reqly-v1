"use client";

import type { RequestStore, HttpMethod, HistoryItem, RequestItem } from "@/hooks/request-types";
import type { CurrentRequest, LastResponse } from "@/src/ai/engine";
import { executeRequest as executeRequestCore } from "@/lib/request-executor";
import type { RequestTab } from "@/lib/request-executor";
import { runProactiveAnalysis } from "@/hooks/store-analysis";
import { toast } from "@/hooks/use-toast";
import { type CommitFn, WORKSPACE_PERSONAL_ID } from "./types";

export function createHistoryMutations(commit: CommitFn) {
  const addToHistory = (
    item: Omit<HistoryItem, "id" | "executedAt" | "createdAt" | "updatedAt">,
  ) => {
    let nextState: RequestStore | null = null;
    commit((prev) => {
      const wsId = prev.activeWorkspaceId ?? WORKSPACE_PERSONAL_ID;
      nextState = {
        ...prev,
        history: [
          {
            ...item,
            workspaceId: wsId,
            id: `hist-${Date.now()}`,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            executedAt: Date.now(),
          },
          ...prev.history,
        ].slice(0, 100),
      };
      return nextState;
    });
    if (nextState) runProactiveAnalysis(nextState);
  };

  const _addHistoryAndNotify = (
    item: Omit<HistoryItem, "id" | "executedAt" | "createdAt" | "updatedAt">,
  ) => {
    addToHistory(item);
    try {
      toast({
        title: `Request ${item.method} ${item.endpoint}`,
        description: `Status: ${item.responseStatus ?? "-"} — ${item.responseTime ?? "-"}ms`,
        variant: "default",
        meta: { event: "requestComplete" },
      });
    } catch {
      // intentionally empty
    }
  };

  const setCurrentRequest = (request: Partial<RequestItem> | RequestItem | CurrentRequest) => {
    const req = request as Partial<RequestItem>;
    const params = Array.isArray(req.queryParams)
      ? Object.fromEntries(req.queryParams.map(({ key, value }) => [key, value]))
      : {};
    const currentRequest: CurrentRequest = {
      method: (req.method || "GET") as HttpMethod,
      url: req.url || "",
      headers: req.headers || {},
      params,
      body: req.body,
      auth: (request as any).auth,
    };
    commit((prev) => ({ ...prev, currentRequest }));
  };

  const setLastResponse = (response: LastResponse | null) => {
    commit((prev) => ({ ...prev, lastResponse: response }));
  };

  const clearHistory = () => {
    commit((prev) => ({ ...prev, history: [] }));
  };

  const removeFromHistory = (id: string) => {
    commit((prev) => ({
      ...prev,
      history: prev.history.filter((h) => h.id !== id),
    }));
  };

  const addAiAuditEntry = (entry: { actionType: string; detail?: any; result?: any }) => {
    const newEntry = {
      ...entry,
      id: `ai-audit-${crypto.randomUUID()}`,
      timestamp: Date.now(),
    };
    commit((prev) => ({
      ...prev,
      aiAudit: [newEntry, ...(prev.aiAudit || [])],
    }));
    return newEntry.id;
  };

  const setAiAutoApply = (enabled: boolean) => {
    commit((prev) => ({ ...prev, aiAutoApply: enabled }));
  };

  const executeRequest = async (request: Partial<RequestItem> | RequestItem) => {
    const req = request as Partial<RequestItem>;

    const snapshot: {
      envVars: Array<{ key: string; value: string; enabled: boolean }>;
      activeWorkspaceId: string | null;
    } = { envVars: [], activeWorkspaceId: null };
    commit((prev) => {
      const activeEnvId = prev.activeEnvironmentId;
      const activeEnv = prev.environments.find((e) => e.id === activeEnvId);
      snapshot.envVars = (activeEnv?.variables?.filter((v) => v.enabled) || []).map((v) => ({
        key: v.key,
        value: v.value,
        enabled: true,
      }));
      snapshot.activeWorkspaceId = prev.activeWorkspaceId;
      return prev;
    });

    const method = (req.method || "GET") as
      "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD";
    const tab: RequestTab = {
      id: "store-execution",
      name: (req as any).name || method,
      method,
      url: req.url || "",
      endpoint: req.endpoint || req.url || "",
      headers: Object.entries(req.headers || {}).map(([k, v]) => ({
        key: k,
        value: String(v),
        enabled: true,
      })),
      queryParams: Array.isArray(req.queryParams)
        ? req.queryParams.map((p) => ({
            key: String(p.key),
            value: String(p.value),
            enabled: true,
          }))
        : [],
      pathParams: [],
      body: typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? ""),
      bodyType: "json",
      authType: "none",
      authToken: "",
      hasResponse: false,
      isSaved: false,
    };

    try {
      const result = await executeRequestCore({
        tab,
        allVars: snapshot.envVars,
        activeProjectPort: 0,
        activeProject: false,
        nativeMode: false,
        activeWorkspaceId: snapshot.activeWorkspaceId,
      });

      const params = Array.isArray(req.queryParams)
        ? Object.fromEntries(req.queryParams.map(({ key, value }) => [key, value]))
        : {};

      setCurrentRequest({
        method: method as HttpMethod,
        url: req.url || "",
        headers: req.headers || {},
        params,
        body: req.body,
        auth: (request as any).auth,
      });

      setLastResponse({
        status: result.responseStatus ?? 0,
        durationMs: result.responseTime ?? 0,
        headers: result.responseHeaders ?? {},
        body: result.responseBody ?? "",
        cookies: result.responseCookies ?? [],
      });

      _addHistoryAndNotify({
        name: (req as any).name || method,
        method,
        url: req.url || "",
        endpoint: req.endpoint || req.url || "",
        headers: req.headers || {},
        body: typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? ""),
        responseStatus: result.responseStatus ?? 0,
        responseTime: result.responseTime ?? 0,
        responseSize: result.responseSize ?? "0 B",
        responseBody: result.responseBody ?? "",
      });

      return result;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setCurrentRequest(request);
      setLastResponse({ status: 0, headers: {}, body: `Error: ${errMsg}` });
      _addHistoryAndNotify({
        name: (req as any).name || method,
        method,
        url: req.url || "",
        endpoint: req.endpoint || req.url || "",
        headers: req.headers || {},
        body: typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? ""),
        responseStatus: 0,
        responseTime: undefined,
        responseSize: "0 B",
        responseBody: `Error: ${errMsg}`,
      });
      return { error: errMsg };
    }
  };

  const executeRequestById = async (requestId: string) => {
    let foundRequest: RequestItem | undefined;
    commit((prev) => {
      for (const c of prev.collections) {
        const found = c.requests.find((r) => r.id === requestId);
        if (found) {
          foundRequest = found;
          break;
        }
      }
      return prev;
    });
    if (foundRequest) return executeRequest(foundRequest);
    return { error: "request-not-found" as const };
  };

  return {
    addToHistory,
    addHistoryAndNotify: _addHistoryAndNotify,
    setCurrentRequest,
    setLastResponse,
    clearHistory,
    removeFromHistory,
    addAiAuditEntry,
    setAiAutoApply,
    executeRequest,
    executeRequestById,
  };
}

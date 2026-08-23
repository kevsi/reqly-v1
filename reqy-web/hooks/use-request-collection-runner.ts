"use client";

import { useCallback } from "react";
import { toast } from "@/hooks/use-toast";
import { fireSystemNotification, pushInAppNotification } from "@/lib/system-notifications";
import { useRequestStore, type Collection, type RequestItem } from "@/hooks/use-request-store";
import { type RequestTab } from "@/lib/request-executor";
import { generateRequestTabId } from "@/lib/request-tab-utils";
import type { RequestTabsState } from "@/hooks/use-request-tabs-state";
import { runCollection as runCollectionWithRunner } from "@/lib/test-runner/runner";
import { createRunnerExecutor } from "@/lib/test-runner/executor";
import type { AssertionResult } from "@/lib/test-runner/types";
import { isTauriInvokeError, type TauriErrorPayload } from "@/lib/tauri";

// Contrats de callbacks issus de useRequestExecutionCore : leurs types précis
// (RequestItem/HistoryItem + résultat d'exécution) ne couvrent pas les shapes
// lâches construites localement (tabs batch/background) — pont volontairement
// non typé, à revisiter si les types d'exécution sont unifiés.
export function useRequestCollectionRunner(
  state: RequestTabsState,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildTabFromRequest: (request: any) => Partial<RequestTab>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  executeRequestWrapper: (tab: RequestTab, showLoading?: boolean) => Promise<any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sendSpecificRequest: (tab: RequestTab, showLoading?: boolean) => Promise<any>,
) {
  const {
    setTabs,
    activeTab,
    setCollectionRequestStatus,
    setCollectionRunLogs,
    setBatchRunCollection,
  } = state;

  const { addHistoryAndNotify } = useRequestStore();

  const runCollectionBackground = useCallback(
    async (collection: Collection) => {
      if (!collection.requests.length) {
        toast({
          title: `Collection "${collection.name}" is empty.`,
          variant: "destructive",
          meta: { event: "collectionComplete" },
        });
        return;
      }

      toast({
        title: `Background execution started for "${collection.name}".`,
        meta: { event: "collectionComplete" },
      });
      setCollectionRequestStatus(`Background: running "${collection.name}"…`);
      setCollectionRunLogs([`Starting execution of collection "${collection.name}"`]);

      // Build a minimal environment from the active environment variables.
      // The runner context requires a synchronous log function.
      const logs: string[] = [];
      const storeState = useRequestStore.getState();
      const activeEnv = storeState.environments.find(
        (e) => e.id === storeState.activeEnvironmentId,
      );
      const environment: Record<string, string> = {};
      for (const v of activeEnv?.variables ?? []) {
        if (v.enabled !== false && v.key.trim() !== "") environment[v.key.trim()] = v.value;
      }
      const runnerCtx = {
        environment,
        iterationData: {} as Record<string, string>,
        iterationIndex: 0,
        log: (msg: string) => {
          logs.push(msg);
          setCollectionRunLogs((prev) => [...prev, msg]);
        },
      };

      try {
        const executor = createRunnerExecutor({
          workspaceId: useRequestStore.getState().activeWorkspaceId,
        });
        const report = await runCollectionWithRunner(collection, runnerCtx, {
          executor,
        });

        for (const r of report.results) {
          const reqItem = collection.requests.find((item) => item.id === r.requestId);
          if (reqItem) {
            addHistoryAndNotify({
              name: reqItem.name,
              method: reqItem.method,
              url: reqItem.url,
              endpoint: reqItem.endpoint,
              headers: reqItem.headers ?? {},
              body: reqItem.body,
              queryParams: reqItem.queryParams,
              responseStatus: r.statusCode,
              responseTime: r.responseTimeMs,
              responseSize: typeof r.assertionResults === "object" ? "—" : "0 B",
              responseBody: typeof r.error === "string" ? r.error : "",
            });
          }
        }

        for (const r of report.results) {
          const passCount = r.assertionResults.filter((a) => a.passed).length;
          const totalAssert = r.assertionResults.length;
          const assertSummary = totalAssert > 0 ? ` (${passCount}/${totalAssert} assertions)` : "";
          setCollectionRunLogs((prev) => [
            ...prev,
            `"${r.requestName}" → ${r.statusCode ?? "?"} in ${r.responseTimeMs ?? 0}ms${assertSummary}${r.error ? ` ERROR: ${r.error}` : ""}`,
          ]);
        }
      } catch (err) {
        console.error("[runCollectionBackground] failed", err);
        toast({
          title: `Background run of "${collection.name}" failed`,
          description: isTauriInvokeError(err)
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err),
          variant: "destructive",
          meta: { event: "collectionComplete" },
        });
      } finally {
        toast({
          title: `Background run of "${collection.name}" completed.`,
          meta: { event: "collectionComplete" },
        });
        fireSystemNotification({
          title: `Collection "${collection.name}" terminée`,
          body: `${collection.requests.length} requête${collection.requests.length > 1 ? "s" : ""} exécutée${collection.requests.length > 1 ? "s" : ""}.`,
          event: "collectionComplete",
          tag: `collection-${collection.id}`,
        });
        pushInAppNotification({
          title: `Collection "${collection.name}" terminée`,
          body: `${collection.requests.length} requête${collection.requests.length > 1 ? "s" : ""} exécutée${collection.requests.length > 1 ? "s" : ""}.`,
          type: "success",
          event: "collectionComplete",
        });
        setCollectionRequestStatus(`Background run completed (${collection.requests.length})`);
        window.setTimeout(() => setCollectionRequestStatus(null), 8000);
      }
    },
    [addHistoryAndNotify, setCollectionRequestStatus, setCollectionRunLogs],
  );

  const runCollection = useCallback(
    async (collection: Collection) => {
      if (!activeTab) return;
      if (!collection.requests.length) {
        toast({
          title: `Collection "${collection.name}" is empty.`,
          variant: "destructive",
          meta: { event: "collectionComplete" },
        });
        return;
      }
      setBatchRunCollection(collection);
    },
    [activeTab, setBatchRunCollection],
  );

  const handleBatchRunRequest = useCallback(
    async (
      request: RequestItem,
      index: number,
    ): Promise<{
      success: boolean;
      status?: number;
      time?: number;
      error?: string;
      transportError?: TauriErrorPayload | null;
      assertionResults?: AssertionResult[];
    }> => {
      void index;
      const newTab: RequestTab = {
        id: `batch-${generateRequestTabId()}`,
        ...buildTabFromRequest(request),
      } as RequestTab;

      setTabs((currentTabs) => [...currentTabs, newTab]);
      try {
        const result = await sendSpecificRequest(newTab, false);
        if (!result) return { success: false, error: `"${request.name}" → failed` };

        return {
          success: !result.transportError,
          status: result.responseStatus ?? 0,
          time: result.responseTime ?? 0,
          error: result.transportError?.message,
          transportError: result.transportError ?? null,
          assertionResults: result.testResults
            ? result.testResults.map(
                (tr: { type: string; expected: unknown; passed: boolean; message?: string }) => ({
                  assertion: {
                    type: tr.type,
                    expected: tr.expected,
                  } as AssertionResult["assertion"],
                  passed: tr.passed,
                  actualValue: undefined,
                  error: tr.passed ? undefined : tr.message,
                }),
              )
            : undefined,
        };
      } catch (err) {
        console.error("[handleBatchRunRequest]", err);
        setTabs((currentTabs) => currentTabs.filter((t) => t.id !== newTab.id));
        toast({
          title: "Batch request failed",
          description: isTauriInvokeError(err)
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err),
          variant: "destructive",
        });
        return {
          success: false,
          error: isTauriInvokeError(err)
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err),
        };
      }
    },
    [buildTabFromRequest, setTabs, sendSpecificRequest],
  );

  return {
    runCollectionBackground,
    runCollection,
    handleBatchRunRequest,
  };
}

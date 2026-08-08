"use client";

import { useCallback } from "react";
import { toast } from "@/hooks/use-toast";
import { fireSystemNotification, pushInAppNotification } from "@/lib/system-notifications";
import { useRequestStore, type Collection, type RequestItem } from "@/hooks/use-request-store";
import { type RequestTab } from "@/lib/request-executor";
import { generateRequestTabId, headersArrayToRecord } from "@/lib/request-tab-utils";
import type { RequestTabsState } from "@/hooks/use-request-tabs-state";
import { runCollection as runCollectionWithRunner } from "@/lib/test-runner/runner";
import type { AssertionResult } from "@/lib/test-runner/types";

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
      const runnerCtx = {
        environment: {} as Record<string, string>,
        iterationData: {} as Record<string, string>,
        iterationIndex: 0,
        log: (msg: string) => {
          logs.push(msg);
          setCollectionRunLogs((prev) => [...prev, msg]);
        },
      };

      try {
        const report = await runCollectionWithRunner(collection, runnerCtx, {
          executor: async (req) => {
            const backgroundTab = {
              ...activeTab,
              ...buildTabFromRequest({
                ...(collection.requests.find((r) => r.method === req.method && r.url === req.url) ??
                  {}),
                method: req.method,
                url: req.url,
                // req.headers is already a Record (headersToRecord ran in the
                // runner); buildTabFromRequest converts it back to Header[]
                // itself — passing an array here would corrupt the headers.
                headers: req.headers ?? {},
                body:
                  typeof req.body === "string"
                    ? req.body
                    : req.body
                      ? JSON.stringify(req.body)
                      : "",
              }),
            } as RequestTab;

            const result = await executeRequestWrapper(backgroundTab, false);
            if (!result) {
              return { statusCode: 0, responseTimeMs: 0, body: null, headers: {} };
            }

            let parsedBody: unknown = result.responseBody ?? "";
            if (typeof result.responseBody === "string") {
              try {
                parsedBody = JSON.parse(result.responseBody);
              } catch {
                /* keep string */
              }
            }

            addHistoryAndNotify({
              name: backgroundTab.name,
              method: backgroundTab.method,
              url: backgroundTab.url,
              endpoint: backgroundTab.endpoint,
              headers: headersArrayToRecord(backgroundTab.headers),
              body: backgroundTab.body,
              queryParams: backgroundTab.queryParams,
              responseStatus: result.responseStatus,
              responseTime: result.responseTime,
              responseSize: result.responseSize,
              responseBody: result.responseBody,
            });

            return {
              statusCode: result.responseStatus ?? 0,
              responseTimeMs: result.responseTime ?? 0,
              body: parsedBody,
              headers: result.responseHeaders ?? {},
            };
          },
        });

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
          description: err instanceof Error ? err.message : String(err),
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
    [
      activeTab,
      buildTabFromRequest,
      executeRequestWrapper,
      addHistoryAndNotify,
      setCollectionRequestStatus,
      setCollectionRunLogs,
    ],
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
          success: true,
          status: result.responseStatus ?? 0,
          time: result.responseTime ?? 0,
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
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
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

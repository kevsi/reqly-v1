"use client";

import { useCallback } from "react";
import { toast } from "@/hooks/use-toast";
import { fireSystemNotification, pushInAppNotification } from "@/lib/system-notifications";
import { useRequestStore, type Collection, type RequestItem } from "@/hooks/use-request-store";
import { type RequestTab } from "@/lib/request-executor";
import { generateRequestTabId } from "@/lib/request-tab-utils";
import type { RequestTabsState } from "@/hooks/use-request-tabs-state";

export function useRequestCollectionRunner(
  state: RequestTabsState,
  buildTabFromRequest: (request: any) => Partial<RequestTab>,
  executeRequestWrapper: (tab: RequestTab, showLoading?: boolean) => Promise<any>,
  sendSpecificRequest: (tab: RequestTab, showLoading?: boolean) => Promise<any>,
) {
  const {
    setTabs,
    activeTab,
    setCollectionRequestStatus,
    setCollectionRunLogs,
    setBatchRunCollection,
    setActiveTabId,
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

      try {
        for (const request of collection.requests) {
          try {
            const backgroundTab = { ...activeTab, ...buildTabFromRequest(request) } as RequestTab;
            const result = await executeRequestWrapper(backgroundTab, false);
            if (!result) continue;
            setCollectionRunLogs((logs) => [
              ...logs,
              `"${request.name}" → ${result.responseStatus ?? 0} en ${result.responseTime ?? 0}ms`,
            ]);
            addHistoryAndNotify({
              name: request.name,
              method: request.method,
              url: request.url,
              endpoint: request.endpoint,
              headers: request.headers,
              body: request.body,
              queryParams: request.queryParams,
              responseStatus: result.responseStatus,
              responseTime: result.responseTime,
              responseSize: result.responseSize,
              responseBody: result.responseBody,
            });
          } catch (reqErr) {
            console.error("[runCollectionBackground] request failed", reqErr);
            toast({
              title: `Request "${request.name}" failed`,
              description: reqErr instanceof Error ? reqErr.message : String(reqErr),
              variant: "destructive",
              meta: { event: "collectionComplete" },
            });
            setCollectionRunLogs((logs) => [
              ...logs,
              `"${request.name}" → ERROR: ${reqErr instanceof Error ? reqErr.message : String(reqErr)}`,
            ]);
          }
        }
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
      toast,
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
    ): Promise<{ success: boolean; status?: number; time?: number; error?: string }> => {
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
    [buildTabFromRequest, setTabs, sendSpecificRequest, toast],
  );

  return {
    runCollectionBackground,
    runCollection,
    handleBatchRunRequest,
  };
}

"use client";

import { useEffect, useCallback } from "react";
import type { PendingCollectionRequest } from "@/lib/request-bridge";
import {
  getAndClearPendingCollectionRequest,
  peekPendingCollectionRequest,
  clearPendingCollectionRequest,
} from "@/lib/request-bridge";

import { toast } from "@/hooks/use-toast";
import { pushInAppNotification } from "@/lib/system-notifications";

import { invokeTauriFetch, isTauriAvailable } from "@/lib/tauri";
import { replayPending, type QueuedRequest } from "@/lib/offline/queue";

import { useRequestStore, type HistoryItem, type RequestItem } from "@/hooks/use-request-store";
import { type RequestTab } from "@/lib/request-executor";
import {
  createEmptyTab,
  generateRequestTabId,
  headersArrayToRecord,
} from "@/lib/request-tab-utils";
import type { RequestTabsState } from "@/hooks/use-request-tabs-state";
import { useRequestExecutionCore } from "@/hooks/use-request-execution-core";
import { useRequestAiEngine } from "@/hooks/use-request-ai-engine";
import { useRequestCollectionRunner } from "@/hooks/use-request-collection-runner";

export function useRequestTabExecution(state: RequestTabsState) {
  const {
    tabs,
    setTabs,
    activeTabId,
    setActiveTabId,
    activeTab,
    isTabsLoaded,
    flashSavedIndicator,
    saveModalOpen,
    setSaveModalOpen,
    saveModalName,
    setSaveModalName,
    saveModalCollectionId,
    setSaveModalCollectionId,
    collectionRequestStatus,
    setCollectionRequestStatus,
    collectionRunLogs,
    batchRunCollection,
    setBatchRunCollection,
  } = state;

  const { collections, history, addRequestToCollection, updateRequestById, variableMappings } =
    useRequestStore();

  const { buildTabFromRequest, executeRequestWrapper, sendSpecificRequest } =
    useRequestExecutionCore(state);

  const { aiEngine, handleAnalyzeRequest, handleGenerateTests, handleGenerateFollowUp } =
    useRequestAiEngine(state, buildTabFromRequest);

  const { runCollectionBackground, runCollection, handleBatchRunRequest } =
    useRequestCollectionRunner(
      state,
      buildTabFromRequest,
      executeRequestWrapper,
      sendSpecificRequest,
    );

  const openRequestInTab = useCallback(
    (request: RequestItem | HistoryItem | PendingCollectionRequest) => {
      const requestId =
        "id" in request && typeof (request as { id?: string }).id === "string"
          ? (request as { id: string }).id
          : undefined;

      if (requestId) {
        const existingTab = tabs.find((t) => t.savedRequestId === requestId);
        if (existingTab) {
          setActiveTabId(existingTab.id);
          return existingTab;
        }
      }

      const newTab: RequestTab = {
        id: generateRequestTabId(),
        ...buildTabFromRequest(request),
      } as RequestTab;

      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(newTab.id);
      return newTab;
    },
    [tabs, buildTabFromRequest, setTabs, setActiveTabId],
  );

  const saveActiveTab = useCallback(() => {
    if (!activeTab) return;

    if (activeTab.isSaved && activeTab.savedRequestId) {
      updateRequestById(activeTab.savedRequestId, {
        name: activeTab.name,
        method: activeTab.method,
        url: activeTab.url,
        endpoint: activeTab.endpoint,
        headers: headersArrayToRecord(activeTab.headers),
        body: activeTab.body,
        bodyType: activeTab.bodyType,
        authType: activeTab.authType,
        authToken: activeTab.authToken,
        queryParams: activeTab.queryParams,
        assertions: activeTab.assertions,
        runnerAssertions: activeTab.runnerAssertions,
        preRequestScript: activeTab.preRequestScript,
        postResponseScript: activeTab.postResponseScript,
        protocol: activeTab.protocol,
        graphql: activeTab.graphql,
        datasetKey: activeTab.datasetKey,
      });
      flashSavedIndicator();
      toast({ title: `"${activeTab.name}" saved` });
      return;
    }

    setSaveModalName(activeTab.name || "New request");
    setSaveModalCollectionId("none");
    setSaveModalOpen(true);
  }, [
    activeTab,
    updateRequestById,
    flashSavedIndicator,
    setSaveModalName,
    setSaveModalCollectionId,
    setSaveModalOpen,
  ]);

  const handleSaveDialogSubmit = useCallback(() => {
    if (!activeTab) return;
    let newSavedId: string | undefined;
    let targetCollectionId = saveModalCollectionId;

    if (saveModalCollectionId === "none") {
      // Fallback to "Drafts" collection (English canonical name used by the store).
      // Legacy: also accept "Brouillons" in case data was persisted before the rename.
      const draftsCollection = collections.find(
        (c) => c.name === "Drafts" || c.name === "Brouillons",
      );
      if (draftsCollection) targetCollectionId = draftsCollection.id;
    }

    if (targetCollectionId !== "none") {
      newSavedId = addRequestToCollection(targetCollectionId, {
        name: saveModalName,
        method: activeTab.method,
        url: activeTab.url,
        endpoint: activeTab.endpoint,
        headers: headersArrayToRecord(activeTab.headers),
        body: activeTab.body,
        bodyType: activeTab.bodyType,
        authType: activeTab.authType,
        authToken: activeTab.authToken,
        queryParams: activeTab.queryParams,
        assertions: activeTab.assertions,
        runnerAssertions: activeTab.runnerAssertions,
        preRequestScript: activeTab.preRequestScript,
        postResponseScript: activeTab.postResponseScript,
        protocol: activeTab.protocol,
        graphql: activeTab.graphql,
        datasetKey: activeTab.datasetKey,
      });
      const targetCollection = collections.find((c) => c.id === targetCollectionId);
      toast({ title: `"${saveModalName}" saved in ${targetCollection?.name || "la collection"}` });
    }

    setTabs((cur) =>
      cur.map((t) =>
        t.id === activeTab.id
          ? { ...t, name: saveModalName, isSaved: true, savedRequestId: newSavedId }
          : t,
      ),
    );

    setSaveModalOpen(false);
    flashSavedIndicator();
  }, [
    activeTab,
    saveModalCollectionId,
    saveModalName,
    collections,
    addRequestToCollection,
    setTabs,
    setSaveModalOpen,
    flashSavedIndicator,
  ]);

  const exportActiveRequest = useCallback(async () => {
    if (!activeTab) return;
    await useRequestStore.getState().exportActiveRequest({
      method: activeTab.method,
      url: activeTab.url,
      requestHeaders: activeTab.headers,
      body: activeTab.body,
      bodyType: activeTab.bodyType,
      authType: activeTab.authType,
      authToken: activeTab.authToken,
      assertions: activeTab.assertions,
    });
  }, [activeTab]);

  const createNewRequestInCollection = useCallback(
    (collectionId: string) => {
      const newRequestId = addRequestToCollection(collectionId, {
        name: "New Request",
        method: "GET",
        url: "",
        endpoint: "",
        headers: {},
        body: "",
        queryParams: [],
        assertions: [],
      });

      const newTab = createEmptyTab({
        id: `tab-${generateRequestTabId()}`,
        isSaved: true,
        savedRequestId: newRequestId,
      });

      setTabs((cur) => [...cur, newTab]);
      setActiveTabId(newTab.id);
      toast({ title: "New request created in collection" });
    },
    [addRequestToCollection, setTabs, setActiveTabId],
  );

  const sendRequest = useCallback(async () => {
    const tab = tabs.find((t) => t.id === activeTabId) || tabs[0];
    if (!tab) return;
    try {
      await sendSpecificRequest(tab);
    } catch (err) {
      console.error("[sendRequest]", err);
      toast({
        title: "Request failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }, [tabs, activeTabId, sendSpecificRequest]);

  const sendAndSave = useCallback(async () => {
    const tab = tabs.find((t) => t.id === activeTabId) || tabs[0];
    if (!tab) return;
    try {
      const result = await sendSpecificRequest(tab);
      if (result) saveActiveTab();
    } catch (err) {
      console.error("[sendAndSave]", err);
      toast({
        title: "Request failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }, [tabs, activeTabId, saveActiveTab, sendSpecificRequest]);

  const sendAndDownload = useCallback(async () => {
    const tab = tabs.find((t) => t.id === activeTabId) || tabs[0];
    if (!tab) return;
    try {
      const result = await sendSpecificRequest(tab);
      if (result?.responseBody) {
        const blob = new Blob([result.responseBody], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${tab.name.replace(/\s+/g, "_")}_response.json`;
        a.click();
        URL.revokeObjectURL(url);
        toast({ title: "Response downloaded" });
      }
    } catch (err) {
      console.error("[sendAndDownload]", err);
      toast({
        title: "Request failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }, [tabs, activeTabId, sendSpecificRequest]);

  const loadRequestIntoActiveTab = useCallback(
    (request: RequestItem | HistoryItem) => {
      openRequestInTab(request);
    },
    [openRequestInTab],
  );

  const loadAndSendRequest = useCallback(
    async (request: RequestItem | HistoryItem) => {
      const currentTab = tabs.find((t) => t.id === activeTabId) || tabs[0];
      const tempTab: RequestTab = { ...currentTab, ...buildTabFromRequest(request) } as RequestTab;
      setTabs((currentTabs) => currentTabs.map((t) => (t.id === activeTabId ? tempTab : t)));
      try {
        await sendSpecificRequest(tempTab);
      } catch (err) {
        console.error("[loadAndSendRequest]", err);
        toast({
          title: "Request failed",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
      }
    },
    [tabs, activeTabId, buildTabFromRequest, sendSpecificRequest, setTabs],
  );

  useEffect(() => {
    if (!isTabsLoaded) return;

    const batchPending = peekPendingCollectionRequest() as PendingCollectionRequest | null;
    if (batchPending && batchPending.collectionId && batchPending.sendImmediately && activeTab) {
      const collectionToRun = collections.find((c) => c.id === batchPending.collectionId);
      if (collectionToRun) {
        clearPendingCollectionRequest();
        const requestsToRun =
          batchPending.requestIds && batchPending.requestIds.length > 0
            ? collectionToRun.requests.filter((r) => batchPending.requestIds!.includes(r.id))
            : collectionToRun.requests;
        const filteredCollection = { ...collectionToRun, requests: requestsToRun };

        void (async () => {
          if (batchPending.background) {
            await runCollectionBackground(filteredCollection);
          } else {
            await runCollection(filteredCollection);
          }
        })();
      }
      return;
    }

    const pendingRequest = getAndClearPendingCollectionRequest() as PendingCollectionRequest | null;
    if (!pendingRequest) return;

    const tab = openRequestInTab(pendingRequest);
    let cleanupTimeout: number | undefined;
    let statusImmediate: number | undefined;
    let statusSentImmediate: number | undefined;

    if (pendingRequest.sendImmediately) {
      statusImmediate = window.setTimeout(
        () => setCollectionRequestStatus("Sending Collections request…"),
        0,
      );
      void (async () => {
        await sendSpecificRequest(tab);
        statusSentImmediate = window.setTimeout(
          () => setCollectionRequestStatus("Collection request sent"),
          0,
        );
        cleanupTimeout = window.setTimeout(() => setCollectionRequestStatus(null), 6000);
      })();
    } else {
      statusImmediate = window.setTimeout(
        () => setCollectionRequestStatus("Collection request loaded in editor"),
        0,
      );
      toast({ title: "Requête chargée dans l'éditeur" });
      cleanupTimeout = window.setTimeout(() => setCollectionRequestStatus(null), 6000);
    }

    return () => {
      if (cleanupTimeout) window.clearTimeout(cleanupTimeout);
      if (statusImmediate) window.clearTimeout(statusImmediate);
      if (statusSentImmediate) window.clearTimeout(statusSentImmediate);
    };
  }, [
    isTabsLoaded,
    activeTab,
    collections,
    openRequestInTab,
    runCollection,
    runCollectionBackground,
    sendSpecificRequest,
    setCollectionRequestStatus,
  ]);

  useEffect(() => {
    const container = document.querySelector(".request-panel-scroll");
    if (container) container.scrollTop = 0;
  }, [activeTabId]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        saveActiveTab();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [saveActiveTab]);

  // Store-and-forward replay: when connectivity is restored, automatically
  // replay any requests that were queued during the outage and notify the user.
  // Only meaningful in the Tauri desktop runtime (the queue lives in Rust).
  useEffect(() => {
    if (!isTauriAvailable()) return;

    const resend = async (req: QueuedRequest) => {
      try {
        const headers = Object.fromEntries(req.headers);
        const body =
          typeof req.body === "string"
            ? req.body
            : req.body
              ? new TextDecoder().decode(Uint8Array.from(req.body))
              : undefined;
        await invokeTauriFetch(
          req.method,
          req.url,
          headers,
          req.method !== "GET" && req.method !== "HEAD" ? body : undefined,
        );
        return { ok: true };
      } catch {
        return { ok: false };
      }
    };

    const onOnline = async () => {
      try {
        const { replayed, succeeded } = await replayPending({ execute: resend });
        if (replayed === 0) return;
        const noun = replayed > 1 ? "requêtes" : "requête";
        toast({
          title: "Reconnexion",
          description: `${replayed} ${noun} rejouée${replayed > 1 ? "s" : ""}, ${succeeded} réussie${succeeded > 1 ? "s" : ""}.`,
        });
        pushInAppNotification({
          title: "Requêtes rejouées",
          body: `${replayed} requête(s) rejouée(s), ${succeeded} réussie(s).`,
          type: succeeded === replayed ? "success" : "warning",
          event: "offlineReplay",
        });
      } catch (e) {
        console.error("[offline replay]", e);
      }
    };

    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  return {
    aiEngine,
    collections,
    history,
    variableMappings,
    collectionRequestStatus,
    collectionRunLogs,
    batchRunCollection,
    setBatchRunCollection,
    saveActiveTab,
    handleSaveDialogSubmit,
    sendRequest,
    sendAndSave,
    sendAndDownload,
    loadRequestIntoActiveTab,
    loadAndSendRequest,
    runCollection,
    handleBatchRunRequest,
    handleAnalyzeRequest,
    handleGenerateTests,
    handleGenerateFollowUp,
    exportActiveRequest,
    createNewRequestInCollection,
    saveModalOpen,
    setSaveModalOpen,
    saveModalName,
    setSaveModalName,
    saveModalCollectionId,
    setSaveModalCollectionId,
  };
}

export type RequestTabExecution = ReturnType<typeof useRequestTabExecution>;

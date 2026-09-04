"use client";

import { useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { PendingCollectionRequest } from "@/lib/request-bridge";
import {
  getAndClearPendingCollectionRequest,
  peekPendingCollectionRequest,
  clearPendingCollectionRequest,
} from "@/lib/request-bridge";

import { toast } from "@/hooks/use-toast";
import { isTauriInvokeError } from "@/lib/tauri";
import { pushInAppNotification } from "@/lib/system-notifications";

import { invokeTauriFetch, isTauriAvailable } from "@/lib/tauri";
import { replayPending, type QueuedRequest } from "@/lib/offline/queue";

import { useRequestStore, type HistoryItem, type RequestItem } from "@/hooks/use-request-store";
import { registerAiExecuteRequestFn } from "@/hooks/use-request-store";
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
  const { t } = useTranslation();
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

  const { buildTabFromRequest, executeRequestWrapper, sendSpecificRequest, cancelRequest } =
    useRequestExecutionCore(state);

  const { handleGenerateFollowUp } =
    useRequestAiEngine(state, buildTabFromRequest);

  const { runCollectionBackground, runCollection, handleBatchRunRequest } =
    useRequestCollectionRunner(
      state,
      buildTabFromRequest,
      executeRequestWrapper,
      sendSpecificRequest,
    );

  // Quand l'IA exécute une requête (via llm-tools ou le cloud-engine), on
  // ouvre un nouvel onglet au lieu d'écraser l'onglet actif. Le callback est
  // enregistré dans le store ; llm-tools/hooks le rappellent via
  // runAiExecuteRequest. Sans lui, executeRequest retombe sur l'onglet courant.
  useEffect(() => {
    registerAiExecuteRequestFn(async (request) => {
      const newTab = createEmptyTab({
        ...buildTabFromRequest(request as RequestItem),
        hasResponse: false,
      });
      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(newTab.id);
      return sendSpecificRequest(newTab);
    });
    return () => registerAiExecuteRequestFn(null);
  }, [buildTabFromRequest, setTabs, setActiveTabId, sendSpecificRequest]);

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
        runnerAssertions: activeTab.runnerAssertions,
        preRequestScript: activeTab.preRequestScript,
        postResponseScript: activeTab.postResponseScript,
        protocol: activeTab.protocol,
        graphql: activeTab.graphql,
        datasetKey: activeTab.datasetKey,
      });
      flashSavedIndicator();
      toast({ title: t("request.saved", { name: activeTab.name }) });
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
    t,
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
        runnerAssertions: activeTab.runnerAssertions,
        preRequestScript: activeTab.preRequestScript,
        postResponseScript: activeTab.postResponseScript,
        protocol: activeTab.protocol,
        graphql: activeTab.graphql,
        datasetKey: activeTab.datasetKey,
      });
      const targetCollection = collections.find((c) => c.id === targetCollectionId);
      toast({
        title: t("request.savedInCollection", {
          name: saveModalName,
          collection: targetCollection?.name || t("request.theCollection"),
        }),
      });
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
    t,
  ]);

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
      });

      const newTab = createEmptyTab({
        id: `tab-${generateRequestTabId()}`,
        isSaved: true,
        savedRequestId: newRequestId,
      });

      setTabs((cur) => [...cur, newTab]);
      setActiveTabId(newTab.id);
      toast({ title: t("request.createdInCollection") });
    },
    [addRequestToCollection, setTabs, setActiveTabId, t],
  );

  const sendRequest = useCallback(async () => {
    const tab = tabs.find((t) => t.id === activeTabId) || tabs[0];
    if (!tab) return;
    try {
      await sendSpecificRequest(tab);
    } catch (err) {
      console.error("[sendRequest]", err);
      toast({
        title: t("request.executionFailed"),
        description: isTauriInvokeError(err)
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err),
        variant: "destructive",
      });
    }
  }, [tabs, activeTabId, sendSpecificRequest, t]);

  const sendAndSave = useCallback(async () => {
    const tab = tabs.find((t) => t.id === activeTabId) || tabs[0];
    if (!tab) return;
    try {
      const result = await sendSpecificRequest(tab);
      if (result) saveActiveTab();
    } catch (err) {
      console.error("[sendAndSave]", err);
      toast({
        title: t("request.executionFailed"),
        description: isTauriInvokeError(err)
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err),
        variant: "destructive",
      });
    }
  }, [tabs, activeTabId, saveActiveTab, sendSpecificRequest, t]);

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
        toast({ title: t("request.responseDownloaded") });
      } else {
        toast({
          title: t("request.nothingToDownload"),
          description: t("request.nothingToDownloadHint"),
          variant: "destructive",
        });
      }
    } catch (err) {
      console.error("[sendAndDownload]", err);
      toast({
        title: t("request.executionFailed"),
        description: isTauriInvokeError(err)
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err),
        variant: "destructive",
      });
    }
  }, [tabs, activeTabId, sendSpecificRequest, t]);

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
          title: t("request.executionFailed"),
          description: isTauriInvokeError(err)
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err),
          variant: "destructive",
        });
      }
    },
    [tabs, activeTabId, buildTabFromRequest, sendSpecificRequest, setTabs, t],
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
        () => setCollectionRequestStatus(t("request.sendingCollection")),
        0,
      );
      void (async () => {
        await sendSpecificRequest(tab);
        statusSentImmediate = window.setTimeout(
          () => setCollectionRequestStatus(t("request.sentCollection")),
          0,
        );
        cleanupTimeout = window.setTimeout(() => setCollectionRequestStatus(null), 6000);
      })();
    } else {
      statusImmediate = window.setTimeout(
        () => setCollectionRequestStatus(t("request.loadedCollection")),
        0,
      );
      toast({ title: t("request.loadedInEditor") });
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
    t,
  ]);

  useEffect(() => {
    const container = document.querySelector(".request-panel-scroll");
    if (container) container.scrollTop = 0;
  }, [activeTabId]);

  // NOTE: Ctrl+S n'est PAS écouté ici — il est géré une seule fois par
  // ShortcutsRegistrar via SHORTCUT_DEFS ("saveRequest" → clic tabbar-save),
  // désormais autorisé dans les champs de saisie. Un second listener window
  // provoquait une double exécution de la sauvegarde.

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
        toast({
          title: t("offline.replayTitle"),
          description: t("offline.replayBody", { replayed, succeeded }),
        });
        pushInAppNotification({
          title: t("offline.replayNotificationTitle"),
          body: t("offline.replayBody", { replayed, succeeded }),
          type: succeeded === replayed ? "success" : "warning",
          event: "offlineReplay",
        });
      } catch (e) {
        console.error("[offline replay]", e);
      }
    };

    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [t]);

  return {
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
    cancelRequest,
    runCollection,
     handleBatchRunRequest,
     handleGenerateFollowUp,
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

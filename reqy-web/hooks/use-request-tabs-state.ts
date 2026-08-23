"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { persistence } from "@/lib/persistence";
import type { RequestTab } from "@/lib/request-executor";
import {
  STORAGE_KEY_TABS,
  createEmptyTab,
  generateRequestTabId,
  headersArrayToRecord,
  initialTabs,
  sanitizeTabForStorage,
} from "@/lib/request-tab-utils";
import { isTauriAvailable } from "@/lib/tauri";
import { toast } from "@/hooks/use-toast";
import { useRequestStore } from "@/hooks/use-request-store";
import { openRequestMassCloseConfirm } from "@/components/request-mass-close-dialog";

export interface TabContextMenu {
  tabId: string;
  x: number;
  y: number;
}

/** Same guard as the single-tab close: unsaved AND carrying content. */
function hasUnsavedContent(tab: RequestTab): boolean {
  return !tab.isSaved && Boolean(tab.url || tab.body);
}

export function useRequestTabsState() {
  const { t } = useTranslation();
  const updateRequestById = useRequestStore((s) => s.updateRequestById);
  const [tabs, setTabs] = useState<RequestTab[]>(initialTabs);
  const [activeTabId, setActiveTabId] = useState(initialTabs[0].id);
  const [isTabsLoaded, setIsTabsLoaded] = useState(false);
  const nativeMode = isTauriAvailable();
  const [loadingCount, setLoadingCount] = useState(0);
  const [savedIndicator, setSavedIndicator] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveModalName, setSaveModalName] = useState("");
  const [saveModalCollectionId, setSaveModalCollectionId] = useState<string>("none");
  const [pendingCloseTab, setPendingCloseTab] = useState<RequestTab | null>(null);
  const [contextMenu, setContextMenu] = useState<TabContextMenu | null>(null);
  const [collectionsDrawerOpen, setCollectionsDrawerOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [chainingOpen, setChainingOpen] = useState(false);
  const [generatingFollowUpId, setGeneratingFollowUpId] = useState<string | null>(null);
  const [collectionRequestStatus, setCollectionRequestStatus] = useState<string | null>(null);
  const [collectionRunLogs, setCollectionRunLogs] = useState<string[]>([]);
  const [batchRunCollection, setBatchRunCollection] = useState<
    import("@/hooks/use-request-store").Collection | null
  >(null);

  const tabListRef = useRef<HTMLDivElement>(null);
  const requestPanelRef = useRef<ImperativePanelHandle | null>(null);
  const responsePanelRef = useRef<ImperativePanelHandle | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [, setIsRequestCollapsed] = useState(false);
  const [, setIsResponseCollapsed] = useState(false);

  const isLoading = loadingCount > 0;
  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  const updateTab = useCallback((tabId: string, patch: Partial<RequestTab>) => {
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, ...patch } : t)));
  }, []);

  const updateScrollButtons = useCallback(() => {
    const el = tabListRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }, []);

  const scrollTabs = useCallback((direction: "left" | "right") => {
    const el = tabListRef.current;
    if (!el) return;
    const tabWidth = el.querySelector("[role='tab']")?.clientWidth ?? 120;
    el.scrollBy({ left: direction === "left" ? -tabWidth : tabWidth, behavior: "smooth" });
  }, []);

  useEffect(() => {
    const el = tabListRef.current;
    if (!el) return;
    updateScrollButtons();
    el.addEventListener("scroll", updateScrollButtons, { passive: true });
    const ro = new ResizeObserver(updateScrollButtons);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", updateScrollButtons);
      ro.disconnect();
    };
  }, [tabs.length, updateScrollButtons]);

  useEffect(() => {
    const loadState = async () => {
      const stored = persistence.getItem<{
        tabs: Array<Omit<RequestTab, "responseData">>;
        activeTabId: string;
      }>(STORAGE_KEY_TABS);
      if (stored) {
        try {
          if (Array.isArray(stored.tabs) && stored.tabs.length > 0) {
            // Rehydrate with defaults so fields stripped at persist time
            // (e.g. authToken) or missing from older data never end up undefined.
            setTabs(stored.tabs.map((tab) => createEmptyTab(tab)) as RequestTab[]);
            if (stored.activeTabId && stored.tabs.some((tab) => tab.id === stored.activeTabId)) {
              setActiveTabId(stored.activeTabId);
            }
          }
        } catch {
          setTabs(initialTabs);
          setActiveTabId(initialTabs[0].id);
        }
      }
      setIsTabsLoaded(true);
    };

    loadState();
  }, []);

  useEffect(() => {
    if (!isTabsLoaded) return;
    void persistence.setItem(STORAGE_KEY_TABS, {
      tabs: tabs.map(sanitizeTabForStorage),
      activeTabId,
    });
  }, [tabs, activeTabId, isTabsLoaded, nativeMode]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [contextMenu]);

  const addNewTab = useCallback(() => {
    const newTab = createEmptyTab({ name: `New Request ${tabs.length + 1}` });
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
  }, [tabs.length]);

  const forceCloseTab = useCallback((id: string) => {
    setTabs((prev) => {
      const newTabs = prev.filter((t) => t.id !== id);
      if (newTabs.length === 0) {
        const newTab = createEmptyTab();
        setActiveTabId(newTab.id);
        return [newTab];
      }
      setActiveTabId((current) => (current === id ? newTabs[newTabs.length - 1].id : current));
      return newTabs;
    });
  }, []);

  const closeTab = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      const tab = tabs.find((t) => t.id === id);
      if (tab && !tab.isSaved && (tab.url || tab.body)) {
        setPendingCloseTab(tab);
        return;
      }
      forceCloseTab(id);
    },
    [tabs, forceCloseTab],
  );

  const duplicateTab = useCallback((tab: RequestTab) => {
    const duplicatedTab: RequestTab = {
      ...tab,
      id: generateRequestTabId(),
      name: `${tab.name} Copy`,
      savedRequestId: undefined,
      hasResponse: false,
      responseBody: undefined,
      responseData: undefined,
      responseHeaders: undefined,
      responseStatus: undefined,
      responseTime: undefined,
      responseSize: undefined,
    };
    setTabs((prev) => [...prev, duplicatedTab]);
    setActiveTabId(duplicatedTab.id);
  }, []);

  /** Mass-close guard: confirm via the unsaved-changes dialog when at least
   *  one candidate tab is unsaved with content, otherwise close right away. */
  const performMassClose = useCallback((candidates: RequestTab[], perform: () => void) => {
    const risky = candidates.filter(hasUnsavedContent);
    if (risky.length === 0) {
      perform();
      return;
    }
    openRequestMassCloseConfirm(risky.length, perform);
  }, []);

  const closeOthers = useCallback(
    (id: string) => {
      const others = tabs.filter((t) => t.id !== id);
      performMassClose(others, () => {
        setTabs((prev) => prev.filter((t) => t.id === id));
        setActiveTabId(id);
      });
    },
    [tabs, performMassClose],
  );

  const closeToRight = useCallback(
    (id: string) => {
      const idx = tabs.findIndex((t) => t.id === id);
      if (idx === -1) return;
      const targets = tabs.slice(idx + 1);
      performMassClose(targets, () => {
        setTabs((prev) => {
          setActiveTabId((current) => {
            const activeIdx = prev.findIndex((t) => t.id === current);
            return activeIdx > idx ? id : current;
          });
          return prev.slice(0, idx + 1);
        });
      });
    },
    [tabs, performMassClose],
  );

  const closeAllTabs = useCallback(() => {
    performMassClose(tabs, () => {
      const newTab = createEmptyTab();
      setTabs([newTab]);
      setActiveTabId(newTab.id);
    });
  }, [tabs, performMassClose]);

  const flashSavedIndicator = useCallback(() => {
    setSavedIndicator(true);
    window.setTimeout(() => setSavedIndicator(false), 2000);
  }, []);

  // Real save: tabs already attached to a collection are persisted through the
  // request store; detached tabs are reported so the user knows they were NOT
  // silently marked as saved.
  const saveAllTabs = useCallback(() => {
    const attached = tabs.filter((tab) => !tab.isSaved && tab.savedRequestId);
    const detached = tabs.filter((tab) => !tab.isSaved && !tab.savedRequestId);

    if (attached.length === 0 && detached.length === 0) {
      toast({
        title: t("runner.tabs.allSaved", {
          defaultValue: "Tous les onglets sont déjà sauvegardés",
        }),
      });
      return;
    }

    for (const tab of attached) {
      updateRequestById(tab.savedRequestId as string, {
        name: tab.name,
        method: tab.method,
        url: tab.url,
        endpoint: tab.endpoint,
        headers: headersArrayToRecord(tab.headers),
        body: tab.body,
        bodyType: tab.bodyType,
        authType: tab.authType,
        authToken: tab.authToken,
        queryParams: tab.queryParams,
        assertions: tab.assertions,
        runnerAssertions: tab.runnerAssertions,
        preRequestScript: tab.preRequestScript,
        postResponseScript: tab.postResponseScript,
        protocol: tab.protocol,
        graphql: tab.graphql,
        datasetKey: tab.datasetKey,
      });
    }

    if (attached.length > 0) {
      setTabs((prev) =>
        prev.map((tab) => (!tab.isSaved && tab.savedRequestId ? { ...tab, isSaved: true } : tab)),
      );
      flashSavedIndicator();
      toast({
        title: t("runner.tabs.savedCount", {
          count: attached.length,
          defaultValue: "{{count}} onglet(s) sauvegardé(s)",
        }),
      });
    }

    if (detached.length > 0) {
      toast({
        title: t("runner.tabs.detachedWarning", {
          count: detached.length,
          defaultValue: "{{count}} onglet(s) non rattaché(s) à une collection",
        }),
        variant: "destructive",
      });
    }
  }, [tabs, updateRequestById, flashSavedIndicator, t]);

  return {
    tabs,
    setTabs,
    activeTabId,
    setActiveTabId,
    activeTab,
    isTabsLoaded,
    nativeMode,
    isLoading,
    setLoadingCount,
    savedIndicator,
    flashSavedIndicator,
    saveModalOpen,
    setSaveModalOpen,
    saveModalName,
    setSaveModalName,
    saveModalCollectionId,
    setSaveModalCollectionId,
    pendingCloseTab,
    setPendingCloseTab,
    contextMenu,
    setContextMenu,
    collectionsDrawerOpen,
    setCollectionsDrawerOpen,
    historyOpen,
    setHistoryOpen,
    chainingOpen,
    setChainingOpen,
    generatingFollowUpId,
    setGeneratingFollowUpId,
    collectionRequestStatus,
    setCollectionRequestStatus,
    collectionRunLogs,
    setCollectionRunLogs,
    batchRunCollection,
    setBatchRunCollection,
    tabListRef,
    requestPanelRef,
    responsePanelRef,
    canScrollLeft,
    canScrollRight,
    scrollTabs,
    setIsRequestCollapsed,
    setIsResponseCollapsed,
    updateTab,
    addNewTab,
    forceCloseTab,
    closeTab,
    duplicateTab,
    closeOthers,
    closeToRight,
    closeAllTabs,
    saveAllTabs,
  };
}

export type RequestTabsState = ReturnType<typeof useRequestTabsState>;

"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { ImperativePanelHandle } from "react-resizable-panels"
import { persistence } from "@/lib/persistence"
import type { RequestTab } from "@/lib/request-executor"
import {
  STORAGE_KEY_TABS,
  createEmptyTab,
  generateRequestTabId,
  initialTabs,
  sanitizeTabForStorage,
} from "@/lib/request-tab-utils"
import { isTauriAvailable } from "@/lib/tauri"
import { toast } from "@/hooks/use-toast"

export interface TabContextMenu {
  tabId: string
  x: number
  y: number
}

export function useRequestTabsState() {
  const [tabs, setTabs] = useState<RequestTab[]>(initialTabs)
  const [activeTabId, setActiveTabId] = useState(initialTabs[0].id)
  const [isTabsLoaded, setIsTabsLoaded] = useState(false)
  const [nativeMode, setNativeMode] = useState(false)
  const [loadingCount, setLoadingCount] = useState(0)
  const [savedIndicator, setSavedIndicator] = useState(false)
  const [saveModalOpen, setSaveModalOpen] = useState(false)
  const [saveModalName, setSaveModalName] = useState("")
  const [saveModalCollectionId, setSaveModalCollectionId] = useState<string>("none")
  const [pendingCloseTab, setPendingCloseTab] = useState<RequestTab | null>(null)
  const [contextMenu, setContextMenu] = useState<TabContextMenu | null>(null)
  const [collectionsDrawerOpen, setCollectionsDrawerOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [chainingOpen, setChainingOpen] = useState(false)
  const [generatingFollowUpId, setGeneratingFollowUpId] = useState<string | null>(null)
  const [collectionRequestStatus, setCollectionRequestStatus] = useState<string | null>(null)
  const [collectionRunLogs, setCollectionRunLogs] = useState<string[]>([])
  const [batchRunCollection, setBatchRunCollection] = useState<import("@/hooks/use-request-store").Collection | null>(null)

  const tabListRef = useRef<HTMLDivElement>(null)
  const requestPanelRef = useRef<ImperativePanelHandle | null>(null)
  const responsePanelRef = useRef<ImperativePanelHandle | null>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const [, setIsRequestCollapsed] = useState(false)
  const [, setIsResponseCollapsed] = useState(false)

  const isLoading = loadingCount > 0
  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0]

  const updateTab = useCallback((tabId: string, patch: Partial<RequestTab>) => {
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, ...patch } : t)))
  }, [])

  const updateScrollButtons = useCallback(() => {
    const el = tabListRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 4)
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4)
  }, [])

  const scrollTabs = useCallback((direction: "left" | "right") => {
    const el = tabListRef.current
    if (!el) return
    const tabWidth = el.querySelector("[role='tab']")?.clientWidth ?? 120
    el.scrollBy({ left: direction === "left" ? -tabWidth : tabWidth, behavior: "smooth" })
  }, [])

  useEffect(() => {
    const el = tabListRef.current
    if (!el) return
    updateScrollButtons()
    el.addEventListener("scroll", updateScrollButtons, { passive: true })
    const ro = new ResizeObserver(updateScrollButtons)
    ro.observe(el)
    return () => {
      el.removeEventListener("scroll", updateScrollButtons)
      ro.disconnect()
    }
  }, [tabs.length, updateScrollButtons])

  useEffect(() => {
    setNativeMode(isTauriAvailable())

    const loadState = async () => {
      const stored = persistence.getItem<{ tabs: Array<Omit<RequestTab, "responseData">>; activeTabId: string }>(STORAGE_KEY_TABS)
      if (stored) {
        try {
          if (Array.isArray(stored.tabs) && stored.tabs.length > 0) {
            setTabs(stored.tabs as RequestTab[])
            if (stored.activeTabId && stored.tabs.some((tab) => tab.id === stored.activeTabId)) {
              setActiveTabId(stored.activeTabId)
            }
          }
        } catch {
          setTabs(initialTabs)
          setActiveTabId(initialTabs[0].id)
        }
      }
      setIsTabsLoaded(true)
    }

    loadState()
  }, [])

  useEffect(() => {
    if (!isTabsLoaded) return
    void persistence.setItem(STORAGE_KEY_TABS, {
      tabs: tabs.map(sanitizeTabForStorage),
      activeTabId,
    })
  }, [tabs, activeTabId, isTabsLoaded, nativeMode])

  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    window.addEventListener("click", close)
    window.addEventListener("scroll", close, true)
    return () => {
      window.removeEventListener("click", close)
      window.removeEventListener("scroll", close, true)
    }
  }, [contextMenu])

  const addNewTab = useCallback(() => {
    const newTab = createEmptyTab({ name: `New Request ${tabs.length + 1}` })
    setTabs((prev) => [...prev, newTab])
    setActiveTabId(newTab.id)
  }, [tabs.length])

  const forceCloseTab = useCallback((id: string) => {
    setTabs((prev) => {
      const newTabs = prev.filter((t) => t.id !== id)
      if (newTabs.length === 0) {
        const newTab = createEmptyTab()
        setActiveTabId(newTab.id)
        return [newTab]
      }
      setActiveTabId((current) => (current === id ? newTabs[newTabs.length - 1].id : current))
      return newTabs
    })
  }, [])

  const closeTab = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const tab = tabs.find((t) => t.id === id)
    if (tab && !tab.isSaved && (tab.url || tab.body)) {
      setPendingCloseTab(tab)
      return
    }
    forceCloseTab(id)
  }, [tabs, forceCloseTab])

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
    }
    setTabs((prev) => [...prev, duplicatedTab])
    setActiveTabId(duplicatedTab.id)
  }, [])

  const closeOthers = useCallback((id: string) => {
    setTabs((prev) => prev.filter((t) => t.id === id))
    setActiveTabId(id)
  }, [])

  const closeToRight = useCallback((id: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id)
      if (idx === -1) return prev
      setActiveTabId((current) => {
        const activeIdx = prev.findIndex((t) => t.id === current)
        return activeIdx > idx ? id : current
      })
      return prev.slice(0, idx + 1)
    })
  }, [])

  const closeAllTabs = useCallback(() => {
    const newTab = createEmptyTab()
    setTabs([newTab])
    setActiveTabId(newTab.id)
  }, [])

  const saveAllTabs = useCallback(() => {
    let count = 0
    setTabs((prev) =>
      prev.map((tab) => {
        if (!tab.isSaved) {
          count++
          return { ...tab, isSaved: true }
        }
        return tab
      }),
    )
    if (count > 0) {
      toast({ title: `Saved ${count} tab${count > 1 ? "s" : ""}` })
    } else {
      toast({ title: "All tabs are already saved" })
    }
  }, [])

  const flashSavedIndicator = useCallback(() => {
    setSavedIndicator(true)
    window.setTimeout(() => setSavedIndicator(false), 2000)
  }, [])

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
  }
}

export type RequestTabsState = ReturnType<typeof useRequestTabsState>

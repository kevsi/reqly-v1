"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Copy,
  List,
  Pencil,
  Plus,
  Save,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { GraphqlTab } from "@/lib/types";
import { useTranslation } from "react-i18next";

interface TabContextMenu {
  tabId: string;
  x: number;
  y: number;
}

interface Props {
  tabs: GraphqlTab[];
  activeTabId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onClose: (id: string) => void;
  onDuplicate: (id: string) => void;
  onCloseOthers: (id: string) => void;
  onCloseToRight: (id: string) => void;
  onCloseAll: () => void;
  onSaveActive: () => void;
  onSaveAll: () => void;
  onRename: (id: string, name: string) => void;
}

const noop = () => {};

export function GraphqlTabBar({
  tabs,
  activeTabId,
  onSelect,
  onAdd,
  onClose,
  onDuplicate,
  onCloseOthers = noop,
  onCloseToRight = noop,
  onCloseAll = noop,
  onSaveActive = noop,
  onSaveAll = noop,
  onRename,
}: Props) {
  const { t } = useTranslation();
  const tabListRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [contextMenu, setContextMenu] = useState<TabContextMenu | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const committedRef = useRef(false);

  const startEdit = (tab: GraphqlTab) => {
    committedRef.current = false;
    setEditingId(tab.id);
    setDraft(tab.name);
  };
  const commit = (tabId: string) => {
    if (committedRef.current) return;
    const name = draft.trim();
    if (name && onRename) onRename(tabId, name);
    committedRef.current = true;
    setEditingId(null);
  };
  const cancelEdit = () => {
    committedRef.current = true;
    setEditingId(null);
  };

  // Close the context menu on outside click/scroll.
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

  const updateScrollButtons = useCallback(() => {
    const el = tabListRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }, []);

  const scrollTabs = useCallback((direction: "left" | "right") => {
    const el = tabListRef.current;
    if (!el) return;
    const tabWidth = el.querySelector("[data-testid^='graphql-tab-']")?.clientWidth ?? 120;
    el.scrollBy({ left: direction === "left" ? -tabWidth : tabWidth, behavior: "smooth" });
  }, []);

  // Refresh the scroll-button state on scroll, resize, and tab count changes.
  useEffect(() => {
    const el = tabListRef.current;
    if (!el) return;
    updateScrollButtons();
    el.addEventListener("scroll", updateScrollButtons, { passive: true });
    // ResizeObserver may be unavailable in some environments (e.g. jsdom);
    // the scroll listener + tab-count effect still keep the state fresh.
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(updateScrollButtons);
      ro.observe(el);
    }
    return () => {
      el.removeEventListener("scroll", updateScrollButtons);
      ro?.disconnect();
    };
  }, [tabs.length, updateScrollButtons]);

  // Keep the active tab visible when switching tabs (mirrors REST tab bar UX).
  // Uses a targeted scrollLeft so only the tab list scrolls (not ancestor panes).
  // `relative` on the scroll container makes offsetLeft resolve against it.
  useEffect(() => {
    const el = tabListRef.current;
    if (!el || !activeTabId) return;
    const activeEl = el.querySelector(
      `[data-testid="graphql-tab-${activeTabId}"]`,
    ) as HTMLElement | null;
    if (!activeEl) return;
    // scrollTo is not implemented in jsdom — guard for test environments.
    if (typeof el.scrollTo !== "function") return;
    const target = activeEl.offsetLeft - el.clientWidth / 2 + activeEl.clientWidth / 2;
    el.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
  }, [activeTabId]);

  const hasActiveTab = tabs.some((t) => t.id === activeTabId);

  return (
    <div className="flex items-center border-b bg-card py-1" data-testid="graphql-tab-bar">
      {canScrollLeft && (
        <button
          type="button"
          onClick={() => scrollTabs("left")}
          className="shrink-0 flex items-center justify-center size-6 mx-0.5 rounded text-muted-foreground/50 hover:text-foreground hover:bg-muted/30 transition-all duration-150"
          title={t("graphql.tabs.scrollLeft")}
          aria-label={t("graphql.tabs.scrollLeft")}
        >
          <ChevronLeft className="size-3.5" />
        </button>
      )}
      <div
        ref={tabListRef}
        role="tablist"
        className="relative flex flex-1 items-center gap-1 overflow-x-auto hide-scrollbar px-1"
      >
        {tabs.map((tab) => {
          const isActive = activeTabId === tab.id;
          return (
            <div
              key={tab.id}
              role="tab"
              tabIndex={isActive ? 0 : -1}
              aria-selected={isActive}
              onClick={() => onSelect(tab.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setContextMenu({ tabId: tab.id, x: e.clientX, y: e.clientY });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(tab.id);
                }
              }}
              className={cn(
                "group flex shrink-0 items-center gap-2 px-3 py-1.5 text-xs rounded-md border transition-colors min-w-[120px] max-w-[200px]",
                isActive
                  ? "bg-background border-border text-foreground"
                  : "bg-muted/30 border-transparent text-muted-foreground hover:bg-muted/50",
              )}
              data-testid={`graphql-tab-${tab.id}`}
              data-active={isActive}
            >
              <span className="text-[10px] font-bold text-primary/80 shrink-0">GQL</span>
              {editingId === tab.id ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => commit(tab.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commit(tab.id);
                    else if (e.key === "Escape") cancelEdit();
                  }}
                  className="max-w-[140px] truncate rounded bg-background px-1 text-xs font-medium outline-none ring-1 ring-primary"
                />
              ) : (
                <span
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    startEdit(tab);
                  }}
                  title={t("graphql.tabs.renameHint")}
                  className="truncate flex-1 text-left cursor-pointer"
                >
                  {tab.name}
                </span>
              )}
              {tab.dirty && !tab.saved && <span className="ml-1 text-warning">●</span>}
              <span
                role="button"
                tabIndex={0}
                aria-label={t("graphql.tabs.closeTab", { name: tab.name })}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation();
                    onClose(tab.id);
                  }
                }}
                className="shrink-0 opacity-60 hover:opacity-100 hover:text-destructive cursor-pointer"
                data-testid={`graphql-tab-close-${tab.id}`}
              >
                <X className="w-3 h-3" />
              </span>
            </div>
          );
        })}
        {activeTabId && (
          <button
            onClick={() => onDuplicate(activeTabId)}
            className="flex shrink-0 items-center gap-1 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground rounded-md hover:bg-muted/50"
            title={t("graphql.tabs.duplicateTab")}
            data-testid="graphql-tab-duplicate"
          >
            <Copy className="w-3 h-3" /> {t("graphql.tabs.duplicate")}
          </button>
        )}
      </div>
      {canScrollRight && (
        <button
          type="button"
          onClick={() => scrollTabs("right")}
          className="shrink-0 flex items-center justify-center size-6 mx-0.5 rounded text-muted-foreground/50 hover:text-foreground hover:bg-muted/30 transition-all duration-150"
          title={t("graphql.tabs.scrollRight")}
          aria-label={t("graphql.tabs.scrollRight")}
        >
          <ChevronRight className="size-3.5" />
        </button>
      )}
      <div className="flex shrink-0 items-center gap-0.5 px-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground/40 hover:text-foreground transition-all duration-200"
              title={t("graphql.tabs.allTabs")}
              data-testid="graphql-tab-list"
            >
              <List className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 max-h-72 overflow-y-auto">
            {tabs.map((tab) => (
              <DropdownMenuItem
                key={tab.id}
                onSelect={() => onSelect(tab.id)}
                className="gap-2 text-xs cursor-pointer"
                data-testid={`graphql-tab-list-item-${tab.id}`}
              >
                <span className="truncate flex-1">
                  {tab.name}
                  {tab.dirty && !tab.saved && <span className="ml-1 text-warning">●</span>}
                </span>
                {tab.id === activeTabId && <CheckCircle className="size-3 text-primary shrink-0" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="ghost"
          size="icon"
          onClick={onAdd}
          disabled={!hasActiveTab}
          className="size-7 text-muted-foreground/50 hover:text-foreground transition-all duration-200"
          title={t("graphql.tabs.newTab")}
          data-testid="graphql-tab-add"
        >
          <Plus className="size-4" />
        </Button>
      </div>

      {contextMenu && (
        <div
          className="fixed z-50 min-w-44 rounded-lg border border-border bg-popover p-1 shadow-lg shadow-black/10"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
          data-testid="graphql-tab-context-menu"
        >
          <button
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
            onClick={() => {
              onSaveActive();
              setContextMenu(null);
            }}
          >
            <Save className="size-3.5" />
            {t("graphql.tabs.save")}
          </button>
          <button
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
            onClick={() => {
              onDuplicate(contextMenu.tabId);
              setContextMenu(null);
            }}
          >
            <Copy className="size-3.5" />
            {t("graphql.tabs.duplicate")}
          </button>
          <button
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
            onClick={() => {
              const tab = tabs.find((t) => t.id === contextMenu.tabId);
              if (tab) startEdit(tab);
              setContextMenu(null);
            }}
          >
            <Pencil className="size-3.5" />
            {t("graphql.tabs.rename")}
          </button>
          <div className="my-1 border-t border-border" />
          <button
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
            onClick={() => {
              onClose(contextMenu.tabId);
              setContextMenu(null);
            }}
          >
            <X className="size-3.5" />
            {t("graphql.tabs.close")}
          </button>
          <button
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
            onClick={() => {
              onCloseOthers(contextMenu.tabId);
              setContextMenu(null);
            }}
          >
            <X className="size-3.5" />
            {t("graphql.tabs.closeOthers")}
          </button>
          <button
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
            onClick={() => {
              onCloseToRight(contextMenu.tabId);
              setContextMenu(null);
            }}
          >
            <X className="size-3.5" />
            {t("graphql.tabs.closeToRight")}
          </button>
          <button
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
            onClick={() => {
              onCloseAll();
              setContextMenu(null);
            }}
          >
            <X className="size-3.5" />
            {t("graphql.tabs.closeAll")}
          </button>
          <div className="my-1 border-t border-border" />
          <button
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
            onClick={() => {
              onSaveAll();
              setContextMenu(null);
            }}
          >
            <Save className="size-3.5" />
            {t("graphql.tabs.saveAll")}
          </button>
        </div>
      )}
    </div>
  );
}

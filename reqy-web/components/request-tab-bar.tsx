"use client";

import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronLeft,
  ChevronRight,
  CheckCircle,
  Clock,
  Copy,
  Folder,
  List,
  Pencil,
  Plus,
  Save,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { RequestTab } from "@/lib/request-executor";
import { methodBadge, getMethodDotClass } from "@/lib/http-method-colors";
import type { TabContextMenu } from "@/hooks/use-request-tabs-state";

export interface RequestTabBarProps {
  tabs: RequestTab[];
  activeTabId: string;
  canScrollLeft: boolean;
  canScrollRight: boolean;
  tabListRef: React.RefObject<HTMLDivElement | null>;
  contextMenu: TabContextMenu | null;
  onSelectTab: (tabId: string) => void;
  onScroll: (direction: "left" | "right") => void;
  onAddTab: () => void;
  onCloseTab: (id: string, e: React.MouseEvent) => void;
  onContextMenu: (menu: TabContextMenu) => void;
  onCloseContextMenu: () => void;
  onSaveActiveTab: () => void;
  onDuplicateTab: (tab: RequestTab) => void;
  onCloseOthers: (id: string) => void;
  onCloseToRight: (id: string) => void;
  onCloseAllTabs: () => void;
  onSaveAllTabs: () => void;
  // Phase HTTP-2: 4 quick-action icons for the active tab, moved here from
  // request-active-toolbar (the toolbar was removed entirely).
  onOpenCollections: () => void;
  onDuplicateActive: () => void;
  onSaveActive: () => void;
  onOpenHistory: () => void;
  onRenameTab?: (tabId: string, name: string) => void;
  layout?: "horizontal" | "vertical";
  effectiveDirection?: "horizontal" | "vertical";
  onToggleLayout?: () => void;
}

export function RequestTabBar({
  tabs,
  activeTabId,
  canScrollLeft,
  canScrollRight,
  tabListRef,
  contextMenu,
  onSelectTab,
  onScroll,
  onAddTab,
  onCloseTab,
  onContextMenu,
  onCloseContextMenu,
  onSaveActiveTab,
  onDuplicateTab,
  onCloseOthers,
  onCloseToRight,
  onCloseAllTabs,
  onSaveAllTabs,
  onOpenCollections,
  onDuplicateActive,
  onSaveActive,
  onOpenHistory,
  onRenameTab,
  layout = "horizontal",
  onToggleLayout,
}: RequestTabBarProps) {
  const { t } = useTranslation();
  const hasActiveTab = tabs.some((t) => t.id === activeTabId);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const committedRef = useRef(false);
  const startEdit = (tab: RequestTab) => {
    committedRef.current = false;
    setEditingId(tab.id);
    setDraft(tab.name);
  };
  const commit = (tabId: string) => {
    if (committedRef.current) return;
    const name = draft.trim();
    if (name && onRenameTab) onRenameTab(tabId, name);
    committedRef.current = true;
    setEditingId(null);
  };
  const cancel = () => {
    committedRef.current = true;
    setEditingId(null);
  };

  return (
    <>
      <div className="flex items-center border-b border-border relative bg-muted/5">
        {canScrollLeft && (
          <button
            type="button"
            onClick={() => onScroll("left")}
            className="shrink-0 flex items-center justify-center size-6 mx-0.5 rounded text-muted-foreground/50 hover:text-foreground hover:bg-muted/30 transition-colors"
            title={t("runner.tabs.scrollLeft")}
          >
            <ChevronLeft className="size-3.5" />
          </button>
        )}
        <div
          ref={tabListRef}
          role="tablist"
          className="flex flex-1 items-center gap-1 overflow-hidden px-1.5"
        >
          {tabs.map((tab) => (
            <div
              key={tab.id}
              role="tab"
              tabIndex={activeTabId === tab.id ? 0 : -1}
              aria-selected={activeTabId === tab.id}
              aria-controls={`tabpanel-${tab.id}`}
              onClick={() => onSelectTab(tab.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onContextMenu({ tabId: tab.id, x: e.clientX, y: e.clientY });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectTab(tab.id);
                } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                  e.preventDefault();
                  const direction = e.key === "ArrowRight" ? 1 : -1;
                  const currentIndex = tabs.findIndex((item) => item.id === tab.id);
                  const nextTab = tabs[(currentIndex + direction + tabs.length) % tabs.length];
                  onSelectTab(nextTab.id);
                  requestAnimationFrame(() => {
                    tabListRef.current
                      ?.querySelector<HTMLElement>(`[data-tab-id="${nextTab.id}"]`)
                      ?.focus();
                  });
                } else if (e.key === "Home" || e.key === "End") {
                  e.preventDefault();
                  const nextTab = e.key === "Home" ? tabs[0] : tabs[tabs.length - 1];
                  onSelectTab(nextTab.id);
                  requestAnimationFrame(() => {
                    tabListRef.current
                      ?.querySelector<HTMLElement>(`[data-tab-id="${nextTab.id}"]`)
                      ?.focus();
                  });
                }
              }}
              data-tab-id={tab.id}
              className={cn(
                "group relative flex shrink-0 cursor-pointer items-center gap-2.5 rounded-t-md px-5 py-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                activeTabId === tab.id
                  ? "bg-background text-foreground"
                  : "text-muted-foreground/60 hover:bg-muted/20 hover:text-foreground/80",
              )}
            >
              {activeTabId === tab.id && <div className="tab-active-bar" />}
              <span
                className={cn("size-1.5 rounded-full shrink-0", getMethodDotClass(tab.method))}
              />
              {editingId === tab.id ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => commit(tab.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commit(tab.id);
                    else if (e.key === "Escape") cancel();
                  }}
                  className="max-w-[200px] truncate rounded bg-background px-1 text-sm font-medium outline-none ring-1 ring-primary"
                />
              ) : (
                <span
                  onDoubleClick={() => startEdit(tab)}
                  title={t("runner.tabs.renameHint")}
                  className="max-w-[200px] cursor-pointer truncate text-sm font-medium"
                >
                  {tab.name}
                </span>
              )}
              {!tab.isSaved && (
                <span
                  title={t("runner.tabs.unsavedHint")}
                  className="size-1.5 rounded-full bg-warning/80 shrink-0"
                />
              )}
              {tab.isSaved && tab.hasResponse && (
                <span className="size-1.5 rounded-full bg-success/60 shrink-0" />
              )}
              <button
                type="button"
                onClick={(e) => onCloseTab(tab.id, e)}
                className={cn(
                  "ml-0.5 flex size-7 shrink-0 items-center justify-center rounded transition-colors hover:bg-muted-foreground/10 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100",
                  activeTabId === tab.id ? "opacity-30" : "opacity-0",
                )}
                data-testid="tabbar-close-tab"
                aria-label={t("runner.tabs.close")}
              >
                <X className="size-3 text-muted-foreground/50 hover:text-foreground" />
              </button>
            </div>
          ))}
        </div>
        {canScrollRight && (
          <button
            type="button"
            onClick={() => onScroll("right")}
            className="shrink-0 flex items-center justify-center size-6 mx-0.5 rounded text-muted-foreground/50 hover:text-foreground hover:bg-muted/30 transition-colors"
            title={t("runner.tabs.scrollRight")}
          >
            <ChevronRight className="size-3.5" />
          </button>
        )}

        {/* Quick actions for the ACTIVE tab — moved here from request-active-toolbar */}
        <div className="flex shrink-0 items-center gap-0.5 border-l border-border/30 px-1.5">
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenCollections}
            disabled={!hasActiveTab}
            className="size-7 text-muted-foreground/60 hover:text-foreground disabled:opacity-30"
            title={t("runner.tabs.collections")}
            data-testid="tabbar-collections"
          >
            <Folder className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onDuplicateActive}
            disabled={!hasActiveTab}
            className="size-7 text-muted-foreground/60 hover:text-foreground disabled:opacity-30"
            title={t("runner.tabs.duplicate")}
            data-testid="tabbar-duplicate"
          >
            <Copy className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onSaveActive}
            disabled={!hasActiveTab}
            className="size-7 text-muted-foreground/60 hover:text-foreground disabled:opacity-30"
            title={t("runner.tabs.saveShortcut")}
            data-testid="tabbar-save"
          >
            <Save className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenHistory}
            disabled={!hasActiveTab}
            className="size-7 text-muted-foreground/60 hover:text-foreground disabled:opacity-30"
            title={t("runner.tabs.history")}
            data-testid="tabbar-history"
          >
            <Clock className="size-3.5" />
          </Button>
        </div>
        <div className="flex shrink-0 items-center gap-0.5 pr-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground/40 hover:text-foreground transition-colors"
                title={t("runner.tabs.allTabs")}
              >
                <List className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 max-h-72 overflow-y-auto">
              {tabs.map((tab) => (
                <DropdownMenuItem
                  key={tab.id}
                  onSelect={() => onSelectTab(tab.id)}
                  className="gap-2 text-xs cursor-pointer"
                >
                  <span className={cn("method-pill shrink-0", methodBadge[tab.method])}>
                    {tab.method}
                  </span>
                  <span className="truncate flex-1">{tab.name}</span>
                  {tab.id === activeTabId && (
                    <CheckCircle className="size-3 text-primary shrink-0" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="icon"
            onClick={onAddTab}
            className="size-7 text-muted-foreground/50 hover:text-foreground transition-colors"
            title={t("runner.tabs.newTab")}
            data-testid="tabbar-add-tab"
          >
            <Plus className="size-4" />
          </Button>
        </div>
      </div>

      {contextMenu && (
        <div
          className="fixed z-50 min-w-44 rounded-lg border border-border bg-popover p-1 shadow-lg shadow-black/10"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
            onClick={() => {
              onSaveActiveTab();
              onCloseContextMenu();
            }}
          >
            <Save className="size-3.5" />
            {t("runner.tabs.save")}
          </button>
          <button
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
            onClick={() => {
              const tab = tabs.find((t) => t.id === contextMenu.tabId);
              if (tab) onDuplicateTab(tab);
              onCloseContextMenu();
            }}
          >
            <Copy className="size-3.5" />
            {t("runner.tabs.duplicateShort")}
          </button>
          <button
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
            onClick={() => {
              const tab = tabs.find((t) => t.id === contextMenu.tabId);
              if (tab) startEdit(tab);
              onCloseContextMenu();
            }}
          >
            <Pencil className="size-3.5" />
            {t("runner.tabs.rename")}
          </button>
          <div className="my-1 border-t border-border" />
          <button
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
            onClick={() => {
              onCloseTab(contextMenu.tabId, { stopPropagation: () => {} } as React.MouseEvent);
              onCloseContextMenu();
            }}
          >
            <X className="size-3.5" />
            {t("runner.tabs.close")}
          </button>
          <button
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
            onClick={() => {
              onCloseOthers(contextMenu.tabId);
              onCloseContextMenu();
            }}
          >
            <X className="size-3.5" />
            {t("runner.tabs.closeOthers")}
          </button>
          <button
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
            onClick={() => {
              onCloseToRight(contextMenu.tabId);
              onCloseContextMenu();
            }}
          >
            <X className="size-3.5" />
            {t("runner.tabs.closeToRight")}
          </button>
          <button
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
            onClick={() => {
              onCloseAllTabs();
              onCloseContextMenu();
            }}
          >
            <X className="size-3.5" />
            {t("runner.tabs.closeAll")}
          </button>
          <div className="my-1 border-t border-border" />
          <button
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
            onClick={() => {
              onSaveAllTabs();
              onCloseContextMenu();
            }}
          >
            <Save className="size-3.5" />
            {t("runner.tabs.saveAll")}
          </button>
        </div>
      )}
    </>
  );
}

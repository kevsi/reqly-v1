"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, Bell, Clock, Command, GitBranch, X, Sparkles } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { Text } from "@/components/ui/text";
import { EnvironmentSelector } from "@/components/environment-selector";
import { VariablesPanel } from "@/components/variables-panel";
import { WorkspaceSelector } from "@/components/workspace-selector";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { AccountMenu } from "@/components/account-menu";

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Command as CommandPalette,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Radio, Braces } from "lucide-react";
import { useRequestStore } from "@/hooks/use-request-store";
import { useShallow } from "zustand/react/shallow";
import { useRouter } from "next/navigation";
import { useAiSidebar } from "@/contexts/ai-sidebar-context";

export function ApiHeader() {
  // Data slices: subscribe only to what we render. Each atomic selector returns
  // the same reference unless that slice actually changes, so the header does
  // NOT re-render on unrelated mutations (e.g. editing a request body).
  const notifications = useRequestStore((s) => s.notifications);
  const storeNotifPermission = useRequestStore((s) => s.systemNotificationPermission);
  // Derive a reliable permission check: trust the store but fall back to the
  // live browser permission (handles hydration mismatches / stale store values).
  const systemNotificationPermission =
    typeof Notification !== "undefined" && Notification.permission === "granted"
      ? "granted"
      : storeNotifPermission;
  const history = useRequestStore((s) => s.history);
  // Actions: stable refs, grouped under useShallow for a single subscription.
  const {
    markNotificationRead,
    removeNotification,
    clearNotifications,
    requestSystemNotificationPermission,
  } = useRequestStore(
    useShallow((s) => ({
      markNotificationRead: s.markNotificationRead,
      removeNotification: s.removeNotification,
      clearNotifications: s.clearNotifications,
      requestSystemNotificationPermission: s.requestSystemNotificationPermission,
    })),
  );
  const router = useRouter();
  const [searchOpen, setSearchOpen] = useState(false);
  const [pendingRemoveNotifId, setPendingRemoveNotifId] = useState<string | null>(null);
  const [showClearNotifConfirm, setShowClearNotifConfirm] = useState(false);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      setSearchOpen(true);
    }
  }, []);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <header className="flex h-12 items-center justify-between border-b border-border bg-gradient-to-r from-background via-muted/10 to-background px-4">
      {/* Logo + Workspace */}
      <div className="flex items-center gap-2">
        <div className="group/logo flex size-8 items-center justify-center rounded-lg border border-border bg-muted/30 transition-all duration-200 hover:border-primary/30 hover:bg-primary/5">
          <div className="size-4 rounded-sm bg-foreground transition-all duration-200 group-hover/logo:bg-primary" />
        </div>
        <WorkspaceSelector />
      </div>

      {/* Search — Ctrl+K palette */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setSearchOpen(true)}
          aria-label="Search"
          className="group/search relative transition-all duration-200 hover:scale-[1.02]"
          title="Search (Ctrl+K)"
        >
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/60 pointer-events-none transition-colors group-hover/search:text-muted-foreground" />
          <div className="flex h-9 w-full max-w-80 items-center rounded-lg border border-input bg-muted/30 pl-9 pr-3 shrink min-w-0 text-sm text-muted-foreground transition-all duration-200 group-hover/search:border-muted-foreground/30 group-hover/search:bg-muted/50 group-focus-within/search:border-primary/50 group-focus-within/search:ring-1 group-focus-within/search:ring-primary/20">
            <span className="flex-1 text-left text-muted-foreground/70">
              Search APIs, endpoints...
            </span>
            <kbd className="hidden sm:inline-flex h-5 select-none items-center gap-1 rounded-md border border-border bg-muted/50 px-1.5 font-mono text-[10px] font-medium text-muted-foreground/70">
              <Command className="size-3" />K
            </kbd>
          </div>
        </button>

        <CommandDialog open={searchOpen} onOpenChange={setSearchOpen}>
          <CommandInput placeholder="Search open tabs, history, pages..." />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            <CommandGroup heading="Tools">
              <CommandItem
                onSelect={() => {
                  setSearchOpen(false);
                  router.push("/sse");
                }}
              >
                <Radio className="mr-2 size-4" />
                <span>Open SSE Panel</span>
              </CommandItem>

              <CommandItem
                onSelect={() => {
                  setSearchOpen(false);
                  router.push("/graphql");
                }}
              >
                <Braces className="mr-2 size-4" />
                <span>Open GraphQL Playground</span>
              </CommandItem>
              <CommandItem
                onSelect={() => {
                  setSearchOpen(false);
                  router.push("/git");
                }}
              >
                <GitBranch className="mr-2 size-4" />
                <span>Open Git Panel</span>
              </CommandItem>
            </CommandGroup>
            <CommandGroup heading="History">
              {history.slice(0, 10).map((item) => (
                <CommandItem key={item.id} onSelect={() => setSearchOpen(false)}>
                  <Clock className="mr-2 size-4" />
                  <span>
                    {item.method} {item.url}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </CommandDialog>
        <EnvironmentSelector />
        <VariablesPanel />
        <ThemeSwitcher />
        <AccountMenu />

        {/* AI Sidebar Toggle */}
        <AiSidebarToggle />

        <div className="flex items-center gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label="Notifications"
                className="group/notif relative flex size-9 items-center justify-center rounded-lg text-muted-foreground/70 transition-all duration-200 hover:bg-accent hover:text-foreground border border-transparent hover:border-border"
                title={
                  notifications && notifications.some((n) => !n.read)
                    ? "Unread notifications"
                    : "Notifications"
                }
              >
                <Bell className="size-5" />
                {notifications && notifications.some((n) => !n.read) && (
                  <span className="absolute -top-0.5 -right-0.5 flex size-2.5 items-center justify-center">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive/60" />
                    <span className="relative inline-flex size-2 rounded-full bg-destructive" />
                  </span>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[320px] animate-scale-in">
              <DropdownMenuLabel className="flex items-center justify-between px-4 py-2">
                <Text variant="label">Notifications</Text>
                {notifications && notifications.length > 0 && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                    {notifications.filter((n) => !n.read).length} new
                  </span>
                )}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {systemNotificationPermission === "default" && (
                <div className="border-b border-border p-3">
                  <button
                    className="w-full rounded-md bg-primary/5 px-3 py-2 text-sm font-medium text-primary transition-all duration-200 hover:bg-primary/10"
                    onClick={async () => {
                      try {
                        await requestSystemNotificationPermission();
                      } catch {
                        // intentionally empty
                      }
                    }}
                  >
                    Enable system notifications
                  </button>
                </div>
              )}
              {systemNotificationPermission === "denied" && (
                <div className="border-b border-border p-3">
                  <p className="text-xs text-muted-foreground">
                    Notifications are blocked in your browser. Re-enable them via the lock icon next
                    to the URL (Notifications → Allow).
                  </p>
                </div>
              )}
              {!notifications || notifications.length === 0 ? (
                <div className="flex flex-col items-center gap-2 p-6 text-sm text-muted-foreground">
                  <Bell className="size-8 text-muted-foreground/30" />
                  <span>No notifications yet</span>
                </div>
              ) : (
                <div className="max-h-[280px] overflow-y-auto">
                  {notifications.map((n) => (
                    <DropdownMenuItem
                      key={n.id}
                      onClick={() => markNotificationRead(n.id)}
                      className="group flex flex-col items-start gap-1.5 px-4 py-3 border-b border-border last:border-b-0 relative"
                    >
                      <div className="flex items-center justify-between w-full">
                        <span
                          className={cn(
                            "text-sm",
                            !n.read
                              ? "font-semibold text-foreground"
                              : "font-medium text-muted-foreground",
                          )}
                        >
                          {n.title}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] text-muted-foreground/60">
                            {new Date(n.createdAt).toLocaleTimeString()}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setPendingRemoveNotifId(n.id);
                            }}
                            className="shrink-0 rounded-md p-0.5 text-muted-foreground/30 opacity-0 group-hover:opacity-100 hover:text-foreground transition-all duration-200"
                            title="Supprimer"
                          >
                            <X className="size-3.5" />
                          </button>
                        </div>
                      </div>
                      {n.body && (
                        <div className="text-xs text-muted-foreground/80 leading-relaxed">
                          {n.body}
                        </div>
                      )}
                      {!n.read && <span className="mt-1 size-1.5 rounded-full bg-primary" />}
                    </DropdownMenuItem>
                  ))}
                </div>
              )}
              <DropdownMenuSeparator />
              <div className="p-2">
                <button
                  className="w-full rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground"
                  onClick={() => setShowClearNotifConfirm(true)}
                >
                  Clear all notifications
                </button>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <ConfirmDialog
        open={!!pendingRemoveNotifId}
        onOpenChange={(open) => {
          if (!open) setPendingRemoveNotifId(null);
        }}
        title="Supprimer cette notification ?"
        description="Cette notification sera définitivement supprimée."
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        onConfirm={() => {
          if (pendingRemoveNotifId) removeNotification(pendingRemoveNotifId);
          setPendingRemoveNotifId(null);
        }}
      />

      <ConfirmDialog
        open={showClearNotifConfirm}
        onOpenChange={setShowClearNotifConfirm}
        title="Effacer toutes les notifications ?"
        description="Toutes les notifications seront définitivement supprimées. Cette action est irréversible."
        confirmLabel="Tout effacer"
        cancelLabel="Annuler"
        onConfirm={() => {
          clearNotifications();
          setShowClearNotifConfirm(false);
        }}
      />
    </header>
  );
}

/** Toggle button for the AI sidebar. Extracted to its own component
 *  so the header doesn't re-render when the sidebar opens/closes. */
function AiSidebarToggle() {
  const { aiSidebarOpen, setAiSidebarOpen } = useAiSidebar();
  return (
    <button
      onClick={() => setAiSidebarOpen(!aiSidebarOpen)}
      className={cn(
        "relative flex size-9 items-center justify-center rounded-lg border transition-all duration-200",
        aiSidebarOpen
          ? "border-primary/40 bg-primary/10 text-primary shadow-[0_0_12px_-4px_hsl(var(--primary))]"
          : "border-transparent text-muted-foreground/70 hover:bg-accent hover:text-foreground hover:border-border",
      )}
      title={aiSidebarOpen ? "Fermer l'assistant IA" : "Ouvrir l'assistant IA (Cmd+I)"}
    >
      <Sparkles className="size-4" />
    </button>
  );
}

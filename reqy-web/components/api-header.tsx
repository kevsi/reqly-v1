"use client";

import { useState, useEffect } from "react";
import { Search, Bell, Clock, Command, GitBranch, X, Sparkles, Menu } from "lucide-react";
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Radio, Braces, Keyboard } from "lucide-react";
import { useRequestStore } from "@/hooks/use-request-store";
import { useSyncStatusStore } from "@/hooks/store/sync";
import { useShallow } from "zustand/react/shallow";
import { useRouter } from "next/navigation";
import { useAiSidebar } from "@/contexts/ai-sidebar-context";
import { useTranslation } from "react-i18next";
import { COMMAND_PALETTE_EVENT, SHORTCUTS_MODAL_EVENT } from "@/hooks/use-shortcuts";

interface ApiHeaderProps {
  /** Ouvre le drawer de navigation sur mobile. */
  onOpenMobileSidebar?: () => void;
}


/** Indicateur d'état de sync (audit UX 2026-09-04 : les erreurs WS
 * n'étaient visibles que dans la console). État dérivé du store. */
function SyncStatusBadge() {
  const wsStatus = useSyncStatusStore((s) => s.wsStatus);
  const { t } = useTranslation();
  // Personnels / connecté / inactif : rien à signaler.
  if (wsStatus === "idle" || wsStatus === "open" || wsStatus === "closed") return null;
  const label = wsStatus === "error" ? t("sync.status.error") : t("sync.status.reconnecting");
  const color = wsStatus === "error" ? "bg-destructive" : "bg-amber-500";
  return (
    <span
      className="text-muted-foreground mr-2 hidden items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium sm:inline-flex"
      role="status"
      aria-live="polite"
    >
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", color)} />
      {label}
    </span>
  );
}

export function ApiHeader({ onOpenMobileSidebar }: ApiHeaderProps) {
  const { t } = useTranslation();
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

  // Ctrl+K est géré de façon centralisée par ShortcutsRegistrar
  // (SHORTCUT_DEFS "search") → événement COMMAND_PALETTE_EVENT. Un seul
  // listener global, aucun doublon ad-hoc ici.
  useEffect(() => {
    const openPalette = () => setSearchOpen(true);
    window.addEventListener(COMMAND_PALETTE_EVENT, openPalette);
    return () => window.removeEventListener(COMMAND_PALETTE_EVENT, openPalette);
  }, []);

  return (
    <header className="flex h-12 items-center justify-between gap-2 border-b border-border bg-gradient-to-r from-background via-muted/10 to-background px-3 sm:px-4 @container">
      <SyncStatusBadge />
      {/* Menu mobile + Logo + Workspace */}
      <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
        {onOpenMobileSidebar && (
          <button
            type="button"
            onClick={onOpenMobileSidebar}
            aria-label={t("header.openMenu")}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground md:hidden"
          >
            <Menu className="size-5" />
          </button>
        )}
        <div className="group/logo hidden size-8 items-center justify-center rounded-lg border border-border bg-muted/30 transition-all duration-200 hover:border-primary/30 hover:bg-primary/5 @min-[22rem]:flex">
          <div className="size-4 rounded-sm bg-foreground transition-all duration-200 group-hover/logo:bg-primary" />
        </div>
        <WorkspaceSelector />
      </div>

      {/* Search — Ctrl+K palette + Environnement + Actions */}
      <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0 shrink-0">
        <button
          onClick={() => setSearchOpen(true)}
          aria-label={t("header.search")}
          data-testid="command-palette-trigger"
          className="group/search relative transition-all duration-200 hover:scale-[1.02] shrink min-w-0"
          title={t("header.searchTitle")}
        >
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/60 pointer-events-none transition-colors group-hover/search:text-muted-foreground hidden @min-[54rem]:block" />
          {/* Largeur pilotée par des container queries : s'ouvre uniquement si l'espace est suffisant */}
          <div className="hidden h-9 w-44 items-center rounded-lg border border-input bg-muted/30 pl-9 pr-3 shrink min-w-0 text-sm text-muted-foreground transition-all duration-200 group-hover/search:border-muted-foreground/30 group-hover/search:bg-muted/50 group-focus-within/search:border-primary/50 group-focus-within/search:ring-1 group-focus-within/search:ring-primary/20 @min-[54rem]:flex @min-[60rem]:w-60 @min-[68rem]:w-72">
            <span className="flex-1 text-left text-muted-foreground/70 truncate">
              {t("header.searchPlaceholder")}
            </span>
            <kbd className="hidden @min-[54rem]:inline-flex h-5 select-none items-center gap-1 rounded-md border border-border bg-muted/50 px-1.5 font-mono text-[10px] font-medium text-muted-foreground/70 shrink-0">
              <Command className="size-3" />K
            </kbd>
          </div>
          {/* Icône seule quand le conteneur est étroit (mobile ou sidebar ouverte) */}
          <span className="flex size-8 items-center justify-center rounded-lg text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground @min-[54rem]:hidden">
            <Search className="size-4" />
          </span>
        </button>

        <CommandDialog open={searchOpen} onOpenChange={setSearchOpen}>
          <CommandInput placeholder={t("header.searchCommandPlaceholder")} />
          <CommandList>
            <CommandEmpty>{t("header.searchNoResults")}</CommandEmpty>
            <CommandGroup heading={t("sidebar.tools")}>
              <CommandItem
                onSelect={() => {
                  setSearchOpen(false);
                  router.push("/sse");
                }}
              >
                <Radio className="mr-2 size-4" />
                <span>{t("header.openSSE")}</span>
              </CommandItem>

              <CommandItem
                onSelect={() => {
                  setSearchOpen(false);
                  router.push("/graphql");
                }}
              >
                <Braces className="mr-2 size-4" />
                <span>{t("header.openGraphql")}</span>
              </CommandItem>
              <CommandItem
                onSelect={() => {
                  setSearchOpen(false);
                  router.push("/git");
                }}
              >
                <GitBranch className="mr-2 size-4" />
                <span>{t("header.openGit")}</span>
              </CommandItem>
            </CommandGroup>
            <CommandGroup heading={t("header.shortcutsGroup", { defaultValue: "Aide" })}>
              <CommandItem
                onSelect={() => {
                  setSearchOpen(false);
                  window.dispatchEvent(new CustomEvent(SHORTCUTS_MODAL_EVENT));
                }}
                data-testid="command-palette-shortcuts"
              >
                <Keyboard className="mr-2 size-4" />
                <span>{t("header.keyboardShortcuts", { defaultValue: "Raccourcis clavier" })}</span>
              </CommandItem>
            </CommandGroup>
            <CommandGroup heading={t("header.history")}>
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
        <span className="hidden @min-[32rem]:block shrink-0">
          <EnvironmentSelector />
        </span>
        <span className="hidden @min-[58rem]:block shrink-0">
          <VariablesPanel />
        </span>
        <div className="shrink-0 flex items-center gap-1.5">
          <ThemeSwitcher />
          <AccountMenu showSignInLink={false} />
          {/* AI Sidebar Toggle */}
          <AiSidebarToggle />
        </div>

        <div className="hidden items-center gap-1.5 @min-[26rem]:flex">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="group/notif relative flex size-9 items-center justify-center rounded-lg text-muted-foreground/70 transition-all duration-200 hover:bg-accent hover:text-foreground border border-transparent hover:border-border"
                title={
                  notifications && notifications.some((n) => !n.read)
                    ? t("header.unreadNotifications")
                    : t("header.notifications")
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
                <Text variant="label">{t("header.notifications")}</Text>
                {notifications && notifications.length > 0 && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                    {t("header.newNotifications", {
                      count: notifications.filter((n) => !n.read).length,
                    })}
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
                    {t("header.enableSystemNotifications")}
                  </button>
                </div>
              )}
              {systemNotificationPermission === "denied" && (
                <div className="border-b border-border p-3">
                  <p className="text-xs text-muted-foreground">
                    {t("header.notificationsBlocked")}
                  </p>
                </div>
              )}
              {!notifications || notifications.length === 0 ? (
                <div className="flex flex-col items-center gap-2 p-6 text-sm text-muted-foreground">
                  <Bell className="size-8 text-muted-foreground/30" />
                  <span>{t("header.noNotifications")}</span>
                </div>
              ) : (
                <div className="max-h-[280px] overflow-y-auto">
                  {notifications.map((n) => (
                    <div
                      key={n.id}
                      className="group flex items-start gap-2 border-b border-border px-3 py-3 last:border-b-0"
                    >
                      <button
                        type="button"
                        onClick={() => markNotificationRead(n.id)}
                        className="min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      >
                        <span
                          className={cn(
                            "block break-words text-sm",
                            !n.read
                              ? "font-semibold text-foreground"
                              : "font-medium text-muted-foreground",
                          )}
                        >
                          {n.title}
                        </span>
                        {n.body && (
                          <span className="mt-1 block break-words text-xs leading-relaxed text-muted-foreground/80">
                            {n.body}
                          </span>
                        )}
                        <span className="mt-1.5 block text-[11px] text-muted-foreground/60">
                          {new Date(n.createdAt).toLocaleTimeString()}
                          {!n.read && (
                            <span className="ml-2 inline-block size-1.5 rounded-full bg-primary align-middle" />
                          )}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingRemoveNotifId(n.id)}
                        className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={t("common.delete")}
                        title={t("common.delete")}
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <DropdownMenuSeparator />
              <div className="p-2">
                <button
                  className="w-full rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground"
                  onClick={() => setShowClearNotifConfirm(true)}
                >
                  {t("header.clearAllNotifications")}
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
        title={t("header.deleteNotificationTitle")}
        description={t("header.deleteNotificationDescription")}
        confirmLabel={t("header.deleteNotification")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => {
          if (pendingRemoveNotifId) removeNotification(pendingRemoveNotifId);
          setPendingRemoveNotifId(null);
        }}
      />

      <ConfirmDialog
        open={showClearNotifConfirm}
        onOpenChange={setShowClearNotifConfirm}
        title={t("header.clearNotificationsTitle")}
        description={t("header.clearNotificationsDescription")}
        confirmLabel={t("header.clearAllConfirm")}
        cancelLabel={t("common.cancel")}
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
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={() => setAiSidebarOpen(!aiSidebarOpen)}
      aria-expanded={aiSidebarOpen}
      aria-controls="reqly-ai-sidebar"
      data-testid="ai-sidebar-toggle"
      className={cn(
        "relative flex size-9 items-center justify-center rounded-lg border transition-all duration-200",
        aiSidebarOpen
          ? "border-primary/40 bg-primary/10 text-primary shadow-[0_0_12px_-4px_hsl(var(--primary))]"
          : "border-transparent text-muted-foreground/70 hover:bg-accent hover:text-foreground hover:border-border",
      )}
      title={aiSidebarOpen ? t("header.toggleAiSidebarClose") : t("header.toggleAiSidebarOpen")}
    >
      <Sparkles className="size-4" />
    </button>
  );
}

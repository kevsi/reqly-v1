"use client";

import Link from "next/link";
import {
  LayoutDashboard,
  Zap,
  Settings,
  ChevronDown,
  Folder,
  FolderCode,
  ChevronsLeft,
  ChevronsRight,
  FolderKanban,
  Play,
  Radio,
  Boxes,
  Activity,
  Link2,
  LogIn,
} from "lucide-react";
import { AppIcon } from "@/components/app-icon";
import { ToolsSection } from "@/components/sidebar/tools-section";
import { ModuleNavList } from "@/components/modules/module-nav-list";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSessionStore } from "@/lib/session-store";

const NAV_ITEMS = [
  {
    icon: LayoutDashboard,
    key: "sidebar.nav.dashboard",
    href: "/dashboard/",
    id: "dashboard",
    fallback: "Tableau de bord",
  },
  {
    icon: Zap,
    key: "sidebar.nav.apiEndpoints",
    href: "/",
    id: "api-endpoints",
    fallback: "API Endpoints",
  },
  {
    icon: Folder,
    key: "sidebar.nav.collections",
    href: "/collections/",
    id: "collections",
    fallback: "Collections",
  },
  {
    icon: FolderCode,
    key: "sidebar.nav.projects",
    href: "/my-projects/",
    id: "projects",
    fallback: "Projets",
  },
  {
    icon: FolderKanban,
    key: "sidebar.nav.workspaces",
    href: "/workspaces/",
    id: "workspaces",
    fallback: "Espaces de travail",
  },
  { icon: Play, key: "sidebar.nav.runner", href: "/runner/", id: "runner", fallback: "Runner" },
  {
    icon: Link2,
    key: "sidebar.nav.chains",
    href: "/chains/",
    id: "chains",
    fallback: "Chaînes",
  },
  {
    icon: Radio,
    key: "sidebar.nav.capture",
    href: "/capture/",
    id: "capture",
    fallback: "Capture",
  },
  { icon: Boxes, key: "sidebar.nav.mocks", href: "/mocks/", id: "mocks", fallback: "Mocks" },
  {
    icon: Activity,
    key: "sidebar.nav.monitors",
    href: "/monitors/",
    id: "monitors",
    fallback: "Monitors",
  },
  {
    icon: Settings,
    key: "sidebar.nav.settings",
    href: "/settings/",
    id: "settings",
    fallback: "Paramètres",
  },
];

interface ApiSidebarProps {
  activePage?: string;
  collapsed?: boolean;
  onCollapse?: (v: boolean) => void;
  /** Mobile drawer: open state + close handler (off-canvas below md). */
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export function ApiSidebar({
  activePage = "api-endpoints",
  collapsed: controlledCollapsed,
  onCollapse,
  mobileOpen = false,
  onMobileClose,
}: ApiSidebarProps) {
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const { t } = useTranslation();
  const collapsed = controlledCollapsed ?? internalCollapsed;
  const isMobile = useIsMobile(768);
  const isAuthenticated = useSessionStore((s) => s.status === "authenticated");
  const drawerRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  // Sur mobile, le drawer est TOUJOURS en pleine largeur avec les libellés,
  // indépendamment de l'état `collapsed` du contexte (forcé à true sous 916px).
  const expanded = isMobile ? true : !collapsed;
  const setCollapsed = (v: boolean) => {
    setInternalCollapsed(v);
    onCollapse?.(v);
  };

  useEffect(() => {
    if (!isMobile) return;

    if (mobileOpen) {
      const activeElement = document.activeElement;
      returnFocusRef.current = activeElement instanceof HTMLElement ? activeElement : null;
      drawerRef.current?.focus({ preventScroll: true });
      return;
    }

    returnFocusRef.current?.focus({ preventScroll: true });
    returnFocusRef.current = null;
  }, [isMobile, mobileOpen]);

  useEffect(() => {
    if (!isMobile || !mobileOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onMobileClose?.();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isMobile, mobileOpen, onMobileClose]);

  // Navigation sur mobile : ferme le drawer après un clic sur un lien.
  const handleNavClick = () => {
    if (isMobile) onMobileClose?.();
  };

  return (
    <aside
      ref={drawerRef}
      aria-label={t("sidebar.ariaLabel")}
      aria-hidden={isMobile && !mobileOpen}
      inert={isMobile && !mobileOpen ? true : undefined}
      tabIndex={-1}
      className={cn(
        "group/sidebar fixed inset-y-0 left-0 z-30 flex flex-col border-r bg-sidebar transition-[width,transform,visibility] duration-200 ease-out will-change-auto h-[calc(var(--vh)*100)]",
        // Desktop: rail replié ou déplié
        !isMobile && (collapsed ? "w-[60px]" : "w-64"),
        // Mobile: drawer off-canvas (pleine hauteur, glissé hors-écran quand fermé)
        isMobile &&
          cn(
            "w-[85vw] max-w-[280px] shadow-2xl shadow-black/30",
            mobileOpen ? "translate-x-0" : "-translate-x-full invisible pointer-events-none",
          ),
      )}
    >
      {/* Header */}
      <div
        className={cn(
          "flex items-center border-b border-sidebar-border px-3 py-4",
          expanded ? "gap-3 px-4" : "justify-center",
        )}
      >
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary">
          <AppIcon aria-hidden="true" className="size-5" />
        </div>
        {expanded && (
          <div className="flex flex-col overflow-hidden">
            <span className="truncate text-sm font-semibold text-foreground">Reqly</span>
            <span className="inline-flex items-center gap-1 truncate rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
              <span className="size-1.5 rounded-full bg-primary" />
              Pro
            </span>
          </div>
        )}
        {expanded && (
          <ChevronDown
            aria-hidden="true"
            className="ml-auto size-4 shrink-0 text-muted-foreground/60"
          />
        )}
      </div>

      {/* Navigation */}
      <nav
        className={cn(
          "flex-1 overflow-y-auto overflow-x-hidden px-2 scrollbar-discreet",
          expanded ? "py-4" : "py-2",
        )}
      >
        <ul className="space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const label = t(item.key, { defaultValue: item.fallback });
            const isActive = item.id === activePage;
            const linkContent = (
              <>
                <item.icon
                  aria-hidden="true"
                  className={cn(
                    "size-[18px] shrink-0",
                    isActive && "text-primary",
                    !isActive && "group-hover/nav-item:text-foreground",
                  )}
                />
                {expanded && <span className="truncate">{label}</span>}
                {isActive && (
                  <span
                    className={cn(
                      "rounded-full bg-primary",
                      expanded
                        ? "ml-auto flex size-1.5"
                        : "absolute -right-0.5 top-1/2 -translate-y-1/2 size-2",
                    )}
                  />
                )}
              </>
            );
            const linkClassName = cn(
              "group/nav-item relative flex items-center rounded-lg px-2 py-2 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar",
              expanded ? "gap-3 px-3" : "justify-center",
              isActive
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            );
            return (
              <li key={item.id} className="relative">
                {isActive && (
                  <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary" />
                )}
                {!expanded ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Link href={item.href} onClick={handleNavClick} className={linkClassName}>
                        {linkContent}
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent side="right" sideOffset={8}>
                      {label}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <Link href={item.href} onClick={handleNavClick} className={linkClassName}>
                    {linkContent}
                  </Link>
                )}
              </li>
            );
          })}
          <ModuleNavList activePage={activePage} collapsed={!expanded} />
        </ul>
        <ToolsSection />
      </nav>

      {/* Se connecter — ancêtre de la sidebar, en bas (affiché tant que déconnecté) */}
      {!isAuthenticated && (
        <div className={cn("border-t border-sidebar-border py-2", expanded ? "px-3" : "px-2")}>
          <div
            className={cn(
              "group/nav-item relative flex items-center rounded-lg px-2 py-2 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar",
              expanded ? "gap-3 px-3" : "justify-center",
              "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )}
          >
            {!expanded ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link href="/login" onClick={handleNavClick} className="flex items-center justify-center">
                    <LogIn
                      aria-hidden="true"
                      className="size-[18px] shrink-0 text-muted-foreground group-hover/nav-item:text-foreground"
                    />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  {t("account.signIn")}
                </TooltipContent>
              </Tooltip>
            ) : (
              <Link href="/login" onClick={handleNavClick} className="flex w-full items-center gap-3">
                <LogIn
                  aria-hidden="true"
                  className="size-[18px] shrink-0 text-muted-foreground group-hover/nav-item:text-foreground"
                />
                <span className="truncate">{t("account.signIn")}</span>
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Collapse toggle button — desktop only (mobile uses the drawer) */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        aria-label={collapsed ? t("sidebar.expand") : t("sidebar.collapse")}
        className="absolute -right-3 top-[72px] flex size-8 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm transition-opacity hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring opacity-0 group-hover/sidebar:opacity-100 max-md:hidden z-10"
        title={collapsed ? t("sidebar.expand") : t("sidebar.collapse")}
      >
        {collapsed ? (
          <ChevronsRight className="size-3.5 transition-transform duration-200 hover:translate-x-0.5" />
        ) : (
          <ChevronsLeft className="size-3.5 transition-transform duration-200 hover:-translate-x-0.5" />
        )}
      </button>
    </aside>
  );
}

"use client";

import { useState, useEffect } from "react";
import { ApiSidebar } from "@/components/api-sidebar";
import { ApiHeader } from "@/components/api-header";
import { AiSidebar } from "@/src/ai/components/ai-sidebar";
import { KeyboardShortcutsModal } from "@/components/keyboard-shortcuts-modal";
import { useSidebar } from "@/contexts/sidebar-context";
import { AiSidebarContext } from "@/contexts/ai-sidebar-context";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ShortcutsRegistrar, SHORTCUTS_MODAL_EVENT } from "@/hooks/use-shortcuts";
import { getModuleRoutes } from "@/lib/modules/registry";

// Maps URL segment → ApiSidebar `activePage` value.
// Centralised here so adding a new page only requires updating one mapping.
const ACTIVE_PAGE_MAP: Record<string, string> = {
  "": "api-endpoints",
  dashboard: "dashboard",
  collections: "collections",
  settings: "settings",
  runner: "runner",
  documentation: "documentation",
  workspaces: "workspaces",
  graphql: "graphql",
  mocks: "mocks",
  "my-projects": "projects", // URL /my-projects but sidebar expects "projects"
  sdks: "sdks",
  capture: "capture",
  git: "git",
  sse: "sse",
};

function getActivePage(pathname: string): string {
  const segment = pathname.split("/")[1] ?? "";
  if (ACTIVE_PAGE_MAP[segment]) return ACTIVE_PAGE_MAP[segment];
  // Module page routes: the first path segment is the nav key the sidebar
  // uses, so highlight the module entry when its route is active.
  const modulePage = getModuleRoutes().find(
    (r) => r.type === "page" && r.path.startsWith(`/${segment}/`),
  );
  return modulePage ? segment : "api-endpoints";
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const {
    isCollapsed,
    toggleSidebar,
    isMobile,
    mobileOpen,
    openMobileSidebar,
    closeMobileSidebar,
  } = useSidebar();
  const pathname = usePathname();
  const activePage = getActivePage(pathname);
  const [aiSidebarOpen, setAiSidebarOpen] = useState(false);
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);

  // Cmd+I / Ctrl+I toggle AI sidebar
  // (Ctrl+K est géré uniquement par ShortcutsRegistrar → palette de commandes ;
  // la modale raccourcis s'ouvre via l'entrée dédiée de la palette)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "i") {
        e.preventDefault();
        setAiSidebarOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    const openShortcuts = () => setShortcutsModalOpen(true);
    window.addEventListener(SHORTCUTS_MODAL_EVENT, openShortcuts);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener(SHORTCUTS_MODAL_EVENT, openShortcuts);
    };
  }, []);

  return (
    <AiSidebarContext.Provider value={{ aiSidebarOpen, setAiSidebarOpen }}>
      <div className="flex h-[calc(var(--vh)*100)] bg-background bg-dot-pattern">
        {/* Mobile backdrop — clic pour fermer le drawer */}
        {isMobile && mobileOpen && (
          <div
            className="fixed inset-0 z-20 bg-black/40 backdrop-blur-[1px] md:hidden"
            onClick={closeMobileSidebar}
            aria-hidden
          />
        )}

        <ApiSidebar
          activePage={activePage}
          collapsed={isCollapsed}
          onCollapse={toggleSidebar}
          mobileOpen={mobileOpen}
          onMobileClose={closeMobileSidebar}
        />

        <div
          className={cn(
            "flex flex-1 flex-col overflow-y-auto overflow-x-hidden transition-[margin] duration-200 ease-out main-content relative",
            // Mobile: drawer off-canvas → contenu pleine largeur.
            // Desktop: marge selon l'état replié (force 60px sous 916px).
            isMobile ? "ml-0" : isCollapsed ? "ml-[60px]" : "ml-64",
            !isMobile && "max-[916px]:ml-[60px]",
          )}
        >
          <ShortcutsRegistrar />
          <ApiHeader onOpenMobileSidebar={openMobileSidebar} />
          {children}
        </div>

        <AiSidebar open={aiSidebarOpen} onClose={() => setAiSidebarOpen(false)} />
        <KeyboardShortcutsModal open={shortcutsModalOpen} onOpenChange={setShortcutsModalOpen} />
      </div>
    </AiSidebarContext.Provider>
  );
}

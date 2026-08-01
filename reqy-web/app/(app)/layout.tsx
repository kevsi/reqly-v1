"use client";

import { useState, useEffect } from "react";
import { ApiSidebar } from "@/components/api-sidebar";
import { ApiHeader } from "@/components/api-header";
import { AiSidebar } from "@/src/ai/components/ai-sidebar";
import { useSidebar } from "@/contexts/sidebar-context";
import { AiSidebarContext } from "@/contexts/ai-sidebar-context";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ShortcutsRegistrar } from "@/hooks/use-shortcuts";
import { getModuleRoutes } from "@/lib/modules/registry";

// Maps URL segment → ApiSidebar `activePage` value.
// Centralised here so adding a new page only requires updating one mapping.
const ACTIVE_PAGE_MAP: Record<string, string> = {
  "": "api-endpoints",
  dashboard: "dashboard",
  collections: "collections",
  settings: "settings",
  runner: "runner",
  "ai-insights": "ai-insights",
  documentation: "documentation",
  workspaces: "workspaces",
  graphql: "graphql",
  "my-projects": "projects", // URL /my-projects but sidebar expects "projects"
  sdks: "sdks",
  capture: "capture",
  websocket: "websocket",
  git: "git",
  sse: "sse",
  grpc: "grpc",
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
  const { isCollapsed, toggleSidebar } = useSidebar();
  const pathname = usePathname();
  const activePage = getActivePage(pathname);
  const [aiSidebarOpen, setAiSidebarOpen] = useState(false);

  // Cmd+I / Ctrl+I toggle
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "i") {
        e.preventDefault();
        setAiSidebarOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <AiSidebarContext.Provider value={{ aiSidebarOpen, setAiSidebarOpen }}>
      <div className="flex h-screen bg-background bg-dot-pattern">
        <ApiSidebar activePage={activePage} collapsed={isCollapsed} onCollapse={toggleSidebar} />

        <div
          className={cn(
            "flex flex-1 flex-col overflow-hidden transition-[margin] duration-200 ease-out main-content relative",
            isCollapsed ? "ml-[60px]" : "ml-64",
            "max-[916px]:ml-[60px]",
          )}
        >
          <ShortcutsRegistrar />
          <ApiHeader />
          {children}
        </div>

        <AiSidebar open={aiSidebarOpen} onClose={() => setAiSidebarOpen(false)} />
      </div>
    </AiSidebarContext.Provider>
  );
}

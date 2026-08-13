"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useCallback,
  type ReactNode,
} from "react";
import { persistence } from "@/lib/persistence";
import { useIsMobile } from "@/hooks/use-mobile";

interface SidebarContextType {
  isCollapsed: boolean;
  toggleSidebar: () => void;
  collapseSidebar: () => void;
  expandSidebar: () => void;
  // Mobile drawer state (below md breakpoint, the sidebar becomes an
  // off-canvas drawer instead of a fixed rail)
  isMobile: boolean;
  mobileOpen: boolean;
  openMobileSidebar: () => void;
  closeMobileSidebar: () => void;
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [isCollapsed, setIsCollapsed] = useState(() => {
    try {
      const stored = persistence.getItem<string>("sidebar-collapsed");
      return stored ? Boolean(JSON.parse(stored)) : true;
    } catch {
      return true;
    }
  });

  const isNarrow = useIsMobile(916);
  const isMobile = useIsMobile(768);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close sidebar automatically on narrower desktop widths
  useEffect(() => {
    if (isNarrow) {
      const t = window.setTimeout(() => setIsCollapsed(true), 0);
      return () => window.clearTimeout(t);
    }
  }, [isNarrow]);

  // Auto-close the mobile drawer when resizing up to desktop
  useEffect(() => {
    if (!isMobile && mobileOpen) {
      const t = window.setTimeout(() => setMobileOpen(false), 0);
      return () => window.clearTimeout(t);
    }
  }, [isMobile, mobileOpen]);

  // Save to persistence
  useEffect(() => {
    try {
      void persistence.setItem("sidebar-collapsed", JSON.stringify(isCollapsed));
    } catch {
      /* ignore */
    }
  }, [isCollapsed]);

  const toggleSidebar = useCallback(() => setIsCollapsed((prev) => !prev), []);
  const collapseSidebar = useCallback(() => setIsCollapsed(true), []);
  const expandSidebar = useCallback(() => setIsCollapsed(false), []);

  const openMobileSidebar = useCallback(() => setMobileOpen(true), []);
  const closeMobileSidebar = useCallback(() => setMobileOpen(false), []);

  const ctxValue = useMemo(
    () => ({
      isCollapsed,
      toggleSidebar,
      collapseSidebar,
      expandSidebar,
      isMobile,
      mobileOpen,
      openMobileSidebar,
      closeMobileSidebar,
    }),
    [
      isCollapsed,
      toggleSidebar,
      collapseSidebar,
      expandSidebar,
      isMobile,
      mobileOpen,
      openMobileSidebar,
      closeMobileSidebar,
    ],
  );

  return <SidebarContext.Provider value={ctxValue}>{children}</SidebarContext.Provider>;
}

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return context;
}

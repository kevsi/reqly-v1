"use client"

import { createContext, useContext, useState, useEffect, useMemo, type ReactNode } from "react"
import { persistence } from "@/lib/persistence"
import { useIsMobile } from "@/hooks/use-mobile"

interface SidebarContextType {
  isCollapsed: boolean
  toggleSidebar: () => void
  collapseSidebar: () => void
  expandSidebar: () => void
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined)

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [isCollapsed, setIsCollapsed] = useState(true)

  const isNarrow = useIsMobile(916)

  // Load from persistence (sync cache populated from localStorage on startup)
  useEffect(() => {
    try {
      const stored = persistence.getItem<string>("sidebar-collapsed")
      if (stored) {
        const t = window.setTimeout(() => setIsCollapsed(JSON.parse(stored)), 0)
        return () => window.clearTimeout(t)
      }
    } catch { /* ignore */ }
    return
  }, [])

  // Close sidebar automatically on narrower desktop widths
  useEffect(() => {
    if (isNarrow) {
      const t = window.setTimeout(() => setIsCollapsed(true), 0)
      return () => window.clearTimeout(t)
    }
  }, [isNarrow])

  // Save to persistence
  useEffect(() => {
    try { void persistence.setItem("sidebar-collapsed", JSON.stringify(isCollapsed)) } catch { /* ignore */ }
  }, [isCollapsed])

  const toggleSidebar = () => setIsCollapsed((prev) => !prev)
  const collapseSidebar = () => setIsCollapsed(true)
  const expandSidebar = () => setIsCollapsed(false)

  const ctxValue = useMemo(
    () => ({ isCollapsed, toggleSidebar, collapseSidebar, expandSidebar }),
    [isCollapsed, toggleSidebar, collapseSidebar, expandSidebar]
  )

  return (
    <SidebarContext.Provider value={ctxValue}>
      {children}
    </SidebarContext.Provider>
  )
}

export function useSidebar() {
  const context = useContext(SidebarContext)
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider")
  }
  return context
}

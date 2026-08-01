"use client"

import { useState, type ReactNode } from "react"
import { SettingsSidebar, type SettingsSection } from "./settings-sidebar"

interface SettingsLayoutProps {
  active: SettingsSection
  onChange: (s: SettingsSection) => void
  children: ReactNode
}

export function SettingsLayout({ active, onChange, children }: SettingsLayoutProps) {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <div className="flex h-full gap-6">
      <SettingsSidebar
        active={active}
        onChange={onChange}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((c) => !c)}
      />
      <main className="flex-1 min-w-0 overflow-y-auto px-4 py-6 lg:px-10 lg:py-8">
        <div className="mx-auto max-w-5xl">{children}</div>
      </main>
    </div>
  )
}

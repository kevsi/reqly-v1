"use client";

import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  Activity,
  Users,
  FolderKanban,
  ScrollText,
  Settings as SettingsIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LoginGate } from "@/components/admin/login-gate";
import { OverviewSection } from "@/components/admin/sections/overview";
import { MonitoringSection } from "@/components/admin/sections/monitoring";
import { UsersSection } from "@/components/admin/sections/users";
import { WorkspacesSection } from "@/components/admin/sections/workspaces";
import { ActivitySection } from "@/components/admin/sections/activity";
import { SettingsSection } from "@/components/admin/sections/settings";
import {
  emptyConfig,
  loadConfig,
  saveConfig,
  clearConfig,
  isSyncReady,
  type AdminConfig,
} from "@/lib/config";

const SECTIONS = [
  { id: "overview", label: "Vue d'ensemble", icon: LayoutDashboard },
  { id: "monitoring", label: "Monitoring", icon: Activity },
  { id: "users", label: "Utilisateurs", icon: Users },
  { id: "workspaces", label: "Workspaces", icon: FolderKanban },
  { id: "activity", label: "Activité", icon: ScrollText },
  { id: "settings", label: "Réglages", icon: SettingsIcon },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

export function AdminApp() {
  const [ready, setReady] = useState(false);
  const [config, setConfig] = useState<AdminConfig>(emptyConfig);
  const [section, setSection] = useState<SectionId>("overview");
  const [dark, setDark] = useState(true);

  useEffect(() => {
    const cfg = loadConfig();
    setConfig(cfg);
    if (isSyncReady(cfg)) setReady(true);
    const stored = localStorage.getItem("reqly_admin_theme");
    const isDark = stored !== "light";
    setDark(isDark);
    document.documentElement.classList.toggle("dark", isDark);
  }, []);

  if (!ready) {
    return (
      <LoginGate
        initial={config}
        onConnect={(cfg) => {
          saveConfig(cfg);
          setConfig(cfg);
          setReady(true);
        }}
      />
    );
  }

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="bg-sidebar border-sidebar-border sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r md:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="bg-primary text-primary-foreground flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold shadow-md shadow-primary/30">
            R
          </div>
          <div>
            <p className="text-sm font-semibold">reqly-admin</p>
            <p className="text-muted-foreground text-[10px]">console opérateur</p>
          </div>
        </div>
        <nav className="mt-2 flex-1 space-y-0.5 px-3">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setSection(id)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                section === id
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground",
              )}
            >
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </nav>
        <div className="text-muted-foreground px-5 py-4 text-[10px]">v0.1 · reqly-admin</div>
      </aside>

      {/* Main */}
      <div className="min-w-0 flex-1">
        {/* Nav mobile */}
        <nav className="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-10 flex gap-1 overflow-x-auto border-b p-2 backdrop-blur md:hidden">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setSection(id)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium",
                section === id ? "bg-accent text-accent-foreground" : "text-muted-foreground",
              )}
            >
              <Icon className="size-3.5" /> {label}
            </button>
          ))}
        </nav>

        <main className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
          {section === "overview" && (
            <OverviewSection config={config} onNeedSettings={() => setSection("settings")} />
          )}
          {section === "monitoring" && <MonitoringSection config={config} />}
          {section === "users" && <UsersSection config={config} />}
          {section === "workspaces" && <WorkspacesSection config={config} />}
          {section === "activity" && <ActivitySection config={config} />}
          {section === "settings" && (
            <SettingsSection
              config={config}
              dark={dark}
              onToggleTheme={(d) => {
                setDark(d);
                document.documentElement.classList.toggle("dark", d);
                localStorage.setItem("reqly_admin_theme", d ? "dark" : "light");
              }}
              onSave={(cfg) => {
                saveConfig(cfg);
                setConfig(cfg);
              }}
              onDisconnect={() => {
                clearConfig();
                setConfig(emptyConfig);
                setReady(false);
                setSection("overview");
              }}
            />
          )}
        </main>
      </div>
    </div>
  );
}

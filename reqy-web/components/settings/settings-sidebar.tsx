"use client";

import {
  Palette,
  Sparkles,
  Bell,
  Plug,
  Keyboard,
  ChevronsLeft,
  ChevronsRight,
  Server,
  Blocks,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type SettingsSection =
  "apparence" | "ai" | "notifications" | "integrations" | "keyboard" | "mcp" | "modules";

interface SectionDef {
  key: SettingsSection;
  label: string;
  icon: LucideIcon;
  destructive?: boolean;
}

const SECTIONS: SectionDef[] = [
  { key: "apparence", label: "Apparence", icon: Palette },
  { key: "ai", label: "Assistant IA", icon: Sparkles },
  { key: "notifications", label: "Notifications", icon: Bell },
  { key: "integrations", label: "Outils connectés", icon: Plug },
  { key: "keyboard", label: "Raccourcis clavier", icon: Keyboard },
  { key: "mcp", label: "Serveur MCP", icon: Server },
  { key: "modules", label: "Modules", icon: Blocks },
];

interface SettingsSidebarProps {
  active: SettingsSection;
  onChange: (s: SettingsSection) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function SettingsSidebar({
  active,
  onChange,
  collapsed,
  onToggleCollapse,
}: SettingsSidebarProps) {
  return (
    <aside
      className={cn(
        "sticky top-0 flex h-full shrink-0 flex-col border-r bg-card transition-[width] duration-200",
        collapsed ? "w-[60px]" : "w-60",
      )}
      aria-label="Sections des paramètres"
    >
      <nav className="flex-1 overflow-y-auto p-2">
        <ul className="space-y-1">
          {SECTIONS.map(({ key, label, icon: Icon, destructive }) => {
            const isActive = active === key;
            return (
              <li key={key} className="relative">
                {isActive && (
                  <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-primary" />
                )}
                <button
                  type="button"
                  onClick={() => onChange(key)}
                  title={collapsed ? label : undefined}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex w-full items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    collapsed ? "justify-center" : "gap-3",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : destructive
                        ? "text-destructive hover:bg-destructive/5"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon className="size-[18px] shrink-0" aria-hidden="true" />
                  {!collapsed && <span className="truncate">{label}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <button
        type="button"
        onClick={onToggleCollapse}
        aria-label={collapsed ? "Étendre la sidebar" : "Réduire la sidebar"}
        className="flex h-10 items-center justify-center border-t text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
      </button>
    </aside>
  );
}

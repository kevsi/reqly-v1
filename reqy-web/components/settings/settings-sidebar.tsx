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
import { useTranslation } from "react-i18next";

export type SettingsSection =
  "apparence" | "ai" | "notifications" | "integrations" | "keyboard" | "mcp" | "modules";

interface SectionDef {
  key: SettingsSection;
  labelKey: `settings.sidebar.${string}`;
  icon: LucideIcon;
  destructive?: boolean;
}

const SECTIONS: SectionDef[] = [
  { key: "apparence", labelKey: "settings.sidebar.apparence", icon: Palette },
  { key: "ai", labelKey: "settings.sidebar.ai", icon: Sparkles },
  { key: "notifications", labelKey: "settings.sidebar.notifications", icon: Bell },
  { key: "integrations", labelKey: "settings.sidebar.integrations", icon: Plug },
  { key: "keyboard", labelKey: "settings.sidebar.keyboard", icon: Keyboard },
  { key: "mcp", labelKey: "settings.sidebar.mcp", icon: Server },
  { key: "modules", labelKey: "settings.sidebar.modules", icon: Blocks },
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
  const { t } = useTranslation();
  return (
    <aside
      className={cn(
        "sticky top-0 flex h-full shrink-0 flex-col border-r bg-card transition-[width] duration-200",
        collapsed ? "w-[60px]" : "w-60",
      )}
      aria-label={t("settings.sidebar.ariaLabel")}
    >
      <nav className="flex-1 overflow-y-auto p-2">
        <ul className="space-y-1">
          {SECTIONS.map(({ key, labelKey, icon: Icon, destructive }) => {
            const label = t(labelKey);
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
        aria-label={collapsed ? t("settings.sidebar.expand") : t("settings.sidebar.collapse")}
        className="flex h-10 items-center justify-center border-t text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
      </button>
    </aside>
  );
}

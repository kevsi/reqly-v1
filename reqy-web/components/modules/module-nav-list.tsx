"use client";

import Link from "next/link";
import { Boxes, Binary, Server, type LucideIcon } from "lucide-react";
import { useEnabledModuleNav } from "@/hooks/use-modules-store";
import { cn } from "@/lib/utils";

/**
 * Resolves the icon string declared in a module manifest to a Lucide icon.
 * Unknown names fall back to a generic icon so a module never renders blank.
 */
const ICONS: Record<string, LucideIcon> = {
  Binary,
  Server,
};
const FALLBACK_ICON: LucideIcon = Boxes;

function iconFor(name?: string): LucideIcon {
  return (name && ICONS[name]) || FALLBACK_ICON;
}

/** The active-page key for a module nav entry is the first path segment. */
function navKey(href: string): string {
  return href.split("/")[1] ?? href;
}

/**
 * Renders the sidebar nav entries contributed by every *enabled* module.
 * Returns null when no module is enabled, so it disappears from the UI
 * entirely. Driven reactively by the module store (updates live when the
 * user installs/enables a module in Settings).
 */
export function ModuleNavList({
  activePage,
  collapsed,
}: {
  activePage: string;
  collapsed: boolean;
}) {
  const nav = useEnabledModuleNav();
  if (nav.length === 0) return null;

  return (
    <>
      <li className="my-1 border-t border-sidebar-border" aria-hidden="true" />
      {nav.map((item) => {
        const key = navKey(item.href);
        const isActive = key === activePage;
        const Icon = iconFor(item.icon);
        return (
          <li key={item.href} className="relative">
            {isActive && (
              <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary shadow-sm shadow-primary/50" />
            )}
            <Link
              href={item.href}
              title={collapsed ? item.label : undefined}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "group/nav-item relative flex items-center rounded-lg px-2 py-2 text-sm font-medium transition-all duration-150",
                collapsed ? "justify-center" : "gap-3 px-3",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
            >
              <Icon
                aria-hidden="true"
                className={cn(
                  "size-[18px] shrink-0",
                  isActive && "text-primary",
                  !isActive && "group-hover/nav-item:text-foreground",
                )}
              />
              {!collapsed && <span className="truncate">{item.label}</span>}
              {isActive && (
                <span
                  className={cn(
                    "rounded-full bg-primary shadow-sm shadow-primary/50",
                    collapsed
                      ? "absolute -right-0.5 top-1/2 -translate-y-1/2 size-2"
                      : "ml-auto flex size-1.5",
                  )}
                />
              )}
            </Link>
          </li>
        );
      })}
    </>
  );
}

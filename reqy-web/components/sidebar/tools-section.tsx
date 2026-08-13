"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Code2, Package, GitBranch, Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import { Text } from "@/components/ui/text";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { useSidebar } from "@/contexts/sidebar-context";
import { useTranslation } from "react-i18next";

const TOOLS = [
  { href: "/graphql/", labelKey: "sidebar.nav.graphql", icon: Code2, color: "text-purple-500" },
  { href: "/sdks/", labelKey: "sidebar.nav.sdks", icon: Package, color: "text-orange-500" },
  { href: "/sse/", labelKey: "sidebar.nav.sse", icon: Radio, color: "text-amber-500" },
  { href: "/git/", labelKey: "sidebar.nav.git", icon: GitBranch, color: "text-rose-500" },
];

export function ToolsSection() {
  const pathname = usePathname();
  const { isCollapsed } = useSidebar();
  const { t } = useTranslation();

  return (
    <div
      className={cn("border-t pt-2 mt-2", !isCollapsed && "pb-2 mb-2")}
      data-testid="tools-section"
    >
      {!isCollapsed && (
        <Text variant="label" className="px-3 py-1">
          {t("sidebar.tools")}
        </Text>
      )}
      <nav className={cn("flex flex-col", isCollapsed ? "gap-1" : "gap-0.5")}>
        {TOOLS.map(
          ({
            href,
            labelKey,
            icon: Icon,
            color,
            badge,
          }: {
            href: string;
            labelKey: string;
            icon: React.ForwardRefExoticComponent<
              Omit<React.SVGProps<SVGSVGElement>, "ref"> & React.RefAttributes<SVGSVGElement>
            >;
            color: string;
            badge?: string;
          }) => {
            const label = t(labelKey);
            const active = pathname?.startsWith(href) ?? false;
            const linkContent = (
              <Link
                href={href}
                data-testid={`tools-link-${label.toLowerCase()}`}
                title={isCollapsed ? label : undefined}
                className={cn(
                  "flex items-center rounded-md text-sm transition-colors",
                  isCollapsed ? "justify-center px-2 py-2" : "gap-2 px-3 py-1.5",
                  active
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                <Icon className={cn(isCollapsed ? "w-5 h-5" : "w-4 h-4", active ? "" : color)} />
                {!isCollapsed && (
                  <div className="flex items-center gap-2 flex-1">
                    <span>{label}</span>
                    {badge && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                        {badge}
                      </Badge>
                    )}
                  </div>
                )}
              </Link>
            );

            if (!isCollapsed) return <div key={href}>{linkContent}</div>;

            return (
              <Tooltip key={href}>
                <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                <TooltipContent side="right" sideOffset={6}>
                  {label}
                </TooltipContent>
              </Tooltip>
            );
          },
        )}
      </nav>
    </div>
  );
}

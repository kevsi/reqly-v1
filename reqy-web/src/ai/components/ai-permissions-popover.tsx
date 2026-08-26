"use client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { REQLY_TOOLS } from "@/lib/llm-tools";
import { isHighImpactTool, loadPermissions, savePermission } from "@/src/ai/agent/permissions";
import type { ToolPermission } from "@/src/ai/agent/types";

const LABEL_KEYS: Record<ToolPermission | "default", string> = {
  allow: "ai.permissions.allow",
  ask: "ai.permissions.ask",
  deny: "ai.permissions.deny",
  default: "ai.permissions.default",
};

interface Props {
  onClose?: () => void;
}

export function AiPermissionsPopover({ onClose }: Props) {
  const { t } = useTranslation();
  const [perms, setPerms] = useState<Record<string, ToolPermission>>(loadPermissions());

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {onClose && (
        <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-4 py-3">
          <span className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="size-3.5 text-primary" />
            {t("ai.agent.permissions")}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="size-6 [&_svg]:size-3.5 text-muted-foreground"
            aria-label={t("ai.permissions.closeAria")}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      )}
      <div className="flex-1 space-y-1 overflow-y-auto px-2 py-2">
        {REQLY_TOOLS.map((tool) => {
          const persisted = perms[tool.name] ?? "default";
          const current: ToolPermission | "default" =
            isHighImpactTool(tool.name) && persisted === "allow" ? "ask" : persisted;
          return (
            <div
              key={t.name}
              className="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-card/50 px-2.5 py-2 transition-colors hover:border-border/80"
            >
              <div className="min-w-0">
                <p className="truncate text-[12px] font-medium text-foreground">{tool.title}</p>
                <p
                  className="truncate font-mono text-[10px] text-muted-foreground/70"
                  title={tool.name}
                >
                  {tool.name}
                </p>
                <p className="truncate text-[10px] text-muted-foreground">{tool.description}</p>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-[10px] shrink-0"
                  >
                    {t(LABEL_KEYS[current])}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  {!isHighImpactTool(tool.name) && (
                    <DropdownMenuItem
                      onSelect={() => {
                        if (savePermission(tool.name, "allow")) {
                          setPerms({ ...perms, [tool.name]: "allow" });
                        }
                      }}
                    >
                      {t(LABEL_KEYS.allow)}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    onSelect={() => {
                      savePermission(tool.name, "ask");
                      setPerms({ ...perms, [tool.name]: "ask" });
                    }}
                  >
                    {t(LABEL_KEYS.ask)}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      savePermission(tool.name, "deny");
                      setPerms({ ...perms, [tool.name]: "deny" });
                    }}
                  >
                    {t(LABEL_KEYS.deny)}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        })}
      </div>
    </div>
  );
}

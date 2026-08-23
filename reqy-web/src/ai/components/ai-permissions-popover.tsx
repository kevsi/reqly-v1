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

const LABELS: Record<ToolPermission | "default", string> = {
  allow: "Toujours autoriser",
  ask: "Demander",
  deny: "Toujours refuser",
  default: "Défaut",
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
        {REQLY_TOOLS.map((t) => {
          const persisted = perms[t.name] ?? "default";
          const current: ToolPermission | "default" =
            isHighImpactTool(t.name) && persisted === "allow" ? "ask" : persisted;
          return (
            <div
              key={t.name}
              className="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-card/50 px-2.5 py-2 transition-colors hover:border-border/80"
            >
              <div className="min-w-0">
                <p className="truncate font-mono text-[11px] text-foreground">{t.name}</p>
                <p className="truncate text-[10px] text-muted-foreground">{t.description}</p>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-[10px] shrink-0"
                  >
                    {LABELS[current]}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  {!isHighImpactTool(t.name) && (
                    <DropdownMenuItem
                      onSelect={() => {
                        if (savePermission(t.name, "allow")) {
                          setPerms({ ...perms, [t.name]: "allow" });
                        }
                      }}
                    >
                      {LABELS.allow}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    onSelect={() => {
                      savePermission(t.name, "ask");
                      setPerms({ ...perms, [t.name]: "ask" });
                    }}
                  >
                    {LABELS.ask}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      savePermission(t.name, "deny");
                      setPerms({ ...perms, [t.name]: "deny" });
                    }}
                  >
                    {LABELS.deny}
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

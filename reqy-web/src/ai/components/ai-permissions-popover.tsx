"use client";
import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { REQLY_TOOLS } from "@/lib/llm-tools";
import { loadPermissions, savePermission } from "@/src/ai/agent/permissions";
import type { ToolPermission } from "@/src/ai/agent/types";

const LABELS: Record<ToolPermission | "default", string> = {
  allow: "Toujours autoriser",
  ask: "Demander",
  deny: "Toujours refuser",
  default: "Défaut",
};

export function AiPermissionsPopover() {
  const [perms, setPerms] = useState<Record<string, ToolPermission>>(loadPermissions());

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs gap-1 text-muted-foreground"
          data-testid="ai-permissions-trigger"
        >
          <ShieldCheck className="size-3" /> Permissions
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 max-h-80 overflow-y-auto">
        {REQLY_TOOLS.map((t) => {
          const current: ToolPermission | "default" = perms[t.name] ?? "default";
          return (
            <div key={t.name} className="flex items-center justify-between gap-2 px-2 py-1.5">
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
                  <DropdownMenuItem
                    onSelect={() => {
                      savePermission(t.name, "allow");
                      setPerms({ ...perms, [t.name]: "allow" });
                    }}
                  >
                    {LABELS.allow}
                  </DropdownMenuItem>
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

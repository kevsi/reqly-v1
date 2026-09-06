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

  const grouped = {
    lecture: REQLY_TOOLS.filter((t) => !isHighImpactTool(t.name) && (["list_", "get_", "search_", "explain_", "propose_"].some((p) => t.name.startsWith(p)) || t.name.startsWith("validate_"))),
    action: REQLY_TOOLS.filter((t) => !isHighImpactTool(t.name) && !["list_", "get_", "search_", "explain_", "propose_", "validate_"].some((p) => t.name.startsWith(p))),
    sensible: REQLY_TOOLS.filter((t) => isHighImpactTool(t.name)),
  };

  const renderRow = (tool: (typeof REQLY_TOOLS)[number]) => {
    const persisted = perms[tool.name] ?? "default";
    const current: ToolPermission | "default" = isHighImpactTool(tool.name) && persisted === "allow" ? "ask" : persisted;
    return (
      <div
        key={tool.name}
        className="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-card/50 px-2.5 py-2 transition-colors hover:border-border/80"
      >
        <div className="min-w-0">
          <p className="truncate text-[12px] font-medium text-foreground">{tool.title}</p>
          <p className="truncate font-mono text-[10px] text-muted-foreground/70" title={tool.name}>
            {tool.name}
          </p>
          <p className="line-clamp-2 text-[10px] leading-snug text-muted-foreground">{tool.description}</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-[10px] shrink-0">
              {t(LABEL_KEYS[current])}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {!isHighImpactTool(tool.name) && (
              <DropdownMenuItem
                onSelect={() => {
                  if (savePermission(tool.name, "allow")) setPerms({ ...perms, [tool.name]: "allow" });
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
  };

  const handleAllowAll = () => {
    const next: Record<string, ToolPermission> = { ...perms };
    for (const tool of REQLY_TOOLS) {
      const target: ToolPermission = isHighImpactTool(tool.name) ? "ask" : "allow";
      if (savePermission(tool.name, target)) next[tool.name] = target;
      else {
        savePermission(tool.name, "ask");
        next[tool.name] = "ask";
      }
    }
    setPerms(next);
  };

  const handleResetAll = () => {
    for (const tool of REQLY_TOOLS) {
      savePermission(tool.name, "ask" as ToolPermission);
      // on supprime la clé pour revenir au défaut, mais on garde ask pour feedback visuel
    }
    // on efface en réécrivant vide via persistence directe
    setPerms({});
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {onClose && (
        <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-4 py-3">
          <span className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="size-3.5 text-primary" />
            {t("ai.agent.permissions")}
          </span>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} className="size-6 [&_svg]:size-3.5 text-muted-foreground" aria-label={t("ai.permissions.closeAria")}>
            <X className="size-3.5" />
          </Button>
        </div>
      )}
      <div className="space-y-2 border-b border-border/40 bg-muted/20 px-4 py-2.5">
        <p className="text-[11px] leading-snug text-muted-foreground">
          {t("ai.permissions.help", { defaultValue: "Autoriser = sans demande. Demander = bouton Confirmer. Refuser = bloqué. Les actions sensibles demandent toujours confirmation, même en Auto." })}
        </p>
        <div className="flex gap-2">
          <Button type="button" size="sm" onClick={handleAllowAll} className="h-7 px-3 text-xs">
            {t("ai.permissions.allowAll", { defaultValue: "Tout autoriser" })}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={handleResetAll} className="h-7 px-3 text-xs">
            {t("ai.permissions.resetAll", { defaultValue: "Tout demander" })}
          </Button>
        </div>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-2 py-3">
        <div>
          <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Lecture — sans risque</p>
          <div className="space-y-1">{grouped.lecture.map(renderRow)}</div>
        </div>
        <div>
          <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Actions simples</p>
          <div className="space-y-1">{grouped.action.map(renderRow)}</div>
        </div>
        <div>
          <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-warning">Actions sensibles — toujours confirmées</p>
          <div className="space-y-1">{grouped.sensible.map(renderRow)}</div>
        </div>
      </div>
    </div>
  );
}

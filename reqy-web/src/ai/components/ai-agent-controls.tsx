"use client";
import { ListChecks, Zap, FileText, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AgentMode } from "@/src/ai/agent/types";

interface Props {
  mode: AgentMode;
  onModeChange: (m: AgentMode) => void;
  autoApply: boolean;
  onAutoApplyChange: (v: boolean) => void;
  onOpenRules: () => void;
  onOpenPermissions: () => void;
}

export function AiAgentControls({
  mode,
  onModeChange,
  autoApply,
  onAutoApplyChange,
  onOpenRules,
  onOpenPermissions,
}: Props) {
  return (
    <div className="flex items-center gap-1" data-testid="ai-agent-controls">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onModeChange(mode === "plan" ? "act" : "plan")}
        className={cn(
          "h-6 px-2 text-[10px] gap-1",
          mode === "plan" ? "text-primary bg-primary/10" : "text-muted-foreground",
        )}
        title="Basculer mode plan/action"
        data-testid="ai-mode-toggle"
      >
        {mode === "plan" ? <ListChecks className="size-3" /> : <Zap className="size-3" />}
        <span className="@max-[24rem]:hidden">{mode === "plan" ? "Plan" : "Action"}</span>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onAutoApplyChange(!autoApply)}
        title={autoApply ? "Auto-approbation activée" : "Activer l'auto-approbation"}
        className={cn(
          "size-6 [&_svg]:size-3",
          autoApply ? "text-primary bg-primary/10" : "text-muted-foreground",
        )}
        data-testid="ai-autoapply-toggle"
      >
        <Zap className="size-3" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onOpenRules}
        title="Règles du workspace"
        className="size-6 [&_svg]:size-3 text-muted-foreground"
        data-testid="ai-rules-button"
      >
        <FileText className="size-3" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onOpenPermissions}
        title="Permissions des outils"
        className="size-6 [&_svg]:size-3 text-muted-foreground"
        data-testid="ai-permissions-button"
      >
        <ShieldCheck className="size-3" />
      </Button>
    </div>
  );
}

"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Plus, FileText, Circle, FileDiff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { FileStatus } from "@/hooks/use-git";

interface StatusRowProps {
  status: FileStatus;
  onStage: (filepath: string) => void;
  onUnstage: (filepath: string) => void;
  onView?: (filepath: string) => void;
  displayName?: string | null;
}

export function GitStatusRow({ status, onStage, onUnstage, onView, displayName }: StatusRowProps) {
  const { t } = useTranslation();
  const isStaged = status.staged !== 1; // 1 = unchanged

  let label = t("git.statusModified");
  let Icon = Circle;
  let iconClass = "text-warning";
  if (status.conflicted) {
    label = t("git.conflictActionRequired");
    Icon = FileDiff;
    iconClass = "text-destructive";
  } else if (status.head === 0 && status.workdir !== 0) {
    label = t("git.statusNew");
    Icon = Plus;
    iconClass = "text-success";
  } else if (status.head === 1 && status.workdir === 0) {
    label = t("git.statusDeleted");
    Icon = FileText;
    iconClass = "text-destructive";
  }

  return (
    <div
      className={cn(
        "group flex items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-accent/50 transition-colors",
        status.conflicted && "bg-destructive/5",
      )}
      onClick={() => onView?.(status.filepath)}
      role={onView ? "button" : undefined}
      title={onView ? t("git.statusViewDiff") : undefined}
    >
      <Checkbox
        checked={isStaged}
        onCheckedChange={(checked) => {
          if (checked) onStage(status.filepath);
          else onUnstage(status.filepath);
        }}
        onClick={(e) => e.stopPropagation()}
        className="size-4 shrink-0"
      />
      <Icon className={`size-3.5 ${iconClass} shrink-0`} />
      <div className="flex-1 min-w-0">
        <span className="block text-xs text-foreground truncate">
          {displayName || status.filepath}
        </span>
        {displayName && (
          <span className="block text-[10px] text-muted-foreground/50 truncate">
            {status.filepath}
          </span>
        )}
      </div>
      {isStaged && (
        <Badge variant="secondary" className="text-[9px] h-4 px-1.5">
          {t("git.statusStaged")}
        </Badge>
      )}
      <Badge
        variant={status.conflicted ? "destructive" : "outline"}
        className={cn("text-[9px] h-4 px-1.5", status.conflicted && "border-destructive/30")}
      >
        {label}
      </Badge>
      {onView && (
        <FileDiff className="size-3 text-muted-foreground/40 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
      )}
    </div>
  );
}

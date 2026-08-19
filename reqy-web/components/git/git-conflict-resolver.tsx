"use client";

import { AlertOctagon, CheckCircle2, FileCode, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface GitConflictResolverProps {
  conflicts: string[];
  onStage: (filepath: string) => Promise<void>;
  onUnstage?: (filepath: string) => Promise<void>;
}

export function GitConflictResolver({ conflicts, onStage }: GitConflictResolverProps) {
  if (conflicts.length === 0) return null;

  return (
    <Card className="border-destructive/30 bg-destructive/5 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-destructive font-medium text-xs">
          <AlertOctagon className="size-4 shrink-0 animate-pulse" />
          <span>Conflits de fusion détectés ({conflicts.length})</span>
        </div>
        <Badge variant="outline" className="border-destructive/30 text-destructive text-[10px]">
          Action requise
        </Badge>
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Des modifications simultanées ont eu lieu lors du pull/merge. Sélectionnez une option pour
        chaque fichier en conflit ou ajustez le fichier manuellement puis marquez-le comme résolu.
      </p>

      <div className="space-y-1.5 pt-1">
        {conflicts.map((filepath) => (
          <div
            key={filepath}
            className="flex items-center justify-between rounded-md border border-destructive/20 bg-background/80 px-2.5 py-1.5 text-xs"
          >
            <div className="flex items-center gap-2 min-w-0">
              <FileCode className="size-3.5 text-destructive shrink-0" />
              <span className="font-mono text-[11px] truncate">{filepath}</span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[10px] gap-1 px-2 hover:bg-success/10 hover:text-success border-border/60"
                onClick={async () => {
                  await onStage(filepath);
                }}
              >
                <Check className="size-3" />
                Marquer résolu
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

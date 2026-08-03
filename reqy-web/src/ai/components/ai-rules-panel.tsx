"use client";
import { useState } from "react";
import { FileText, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { loadRules, saveRules } from "@/src/ai/agent/rules";

interface Props {
  workspaceId: string;
  onClose: () => void;
}

export function AiRulesPanel({ workspaceId, onClose }: Props) {
  const initial = loadRules(workspaceId);
  const [content, setContent] = useState(initial?.content ?? "");

  return (
    <div className="border-t border-border p-3" data-testid="ai-rules-panel">
      <div className="mb-2 flex items-center justify-between gap-2 min-w-0">
        <span className="flex items-center gap-1.5 text-xs font-medium text-foreground min-w-0">
          <FileText className="size-3.5 shrink-0 text-primary" />
          <span className="min-w-0 truncate">Règles du workspace</span>
          <span className="shrink-0 text-muted-foreground/70 @max-[24rem]:hidden">
            (AGENTS-like)
          </span>
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="size-6 [&_svg]:size-3.5 text-muted-foreground"
          aria-label="Fermer les règles"
        >
          <X className="size-3.5" />
        </Button>
      </div>
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={
          "Toujours valider les bodies JSON.\nNe jamais exécuter de DELETE sans confirmation."
        }
        rows={5}
        className="text-xs font-mono resize-y"
      />
      <div className="mt-2 flex justify-end">
        <Button
          type="button"
          variant="default"
          size="sm"
          className="h-7 px-3 text-xs"
          onClick={() => {
            saveRules(workspaceId, content);
            onClose();
          }}
        >
          <Save className="size-3 mr-1" /> Enregistrer
        </Button>
      </div>
    </div>
  );
}

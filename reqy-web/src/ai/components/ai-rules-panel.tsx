"use client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { loadRules, saveRules } from "@/src/ai/agent/rules";

interface Props {
  workspaceId: string;
  onClose: () => void;
}

export function AiRulesPanel({ workspaceId, onClose }: Props) {
  const { t } = useTranslation();
  const initial = loadRules(workspaceId);
  const [content, setContent] = useState(initial?.content ?? "");

  return (
    <div className="flex flex-1 flex-col p-3" data-testid="ai-rules-panel">
      <div className="mb-2 flex items-center justify-between gap-2 min-w-0">
        <span className="flex items-center gap-1.5 text-xs font-medium text-foreground min-w-0">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary ring-1 ring-primary/20">
            <FileText className="size-3" />
          </span>
          <span className="min-w-0 truncate">{t("ai.rules.title")}</span>
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
          aria-label={t("ai.rules.closeAria")}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={t("ai.rules.placeholder")}
        rows={5}
        className="flex-1 resize-none text-xs font-mono"
      />
      <div className="mt-2 flex justify-end">
        <Button
          type="button"
          variant="default"
          size="sm"
          className="h-7 px-3 text-xs shadow-[0_2px_10px_-2px] shadow-primary/40"
          onClick={() => {
            saveRules(workspaceId, content);
            onClose();
          }}
        >
          <Save className="size-3 mr-1" /> {t("common.save")}
        </Button>
      </div>
    </div>
  );
}

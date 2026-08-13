"use client";

import { Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { ConversationSession } from "@/src/ai/components/ai-sidebar-types";

interface AiHistoryPanelProps {
  sessions: ConversationSession[];
  currentSessionId: string | null;
  onSelectSession: (session: ConversationSession) => void;
  onDeleteSession: (id: string) => void;
  onNewSession: () => void;
}

export function AiHistoryPanel({
  sessions,
  currentSessionId,
  onSelectSession,
  onDeleteSession,
  onNewSession,
}: AiHistoryPanelProps) {
  const { t } = useTranslation();
  return (
    <div>
      <div className="flex items-center justify-between gap-2 border-b border-border/50 px-4 py-2.5 min-w-0">
        <span className="truncate text-xs font-medium text-muted-foreground">
          {t("ai.history.title")}
        </span>
        <button
          onClick={onNewSession}
          title={t("ai.history.newTitle")}
          className="flex shrink-0 items-center gap-1 rounded-md border border-border/60 bg-background px-2 py-0.5 text-xs text-primary transition-colors hover:bg-accent/50"
        >
          <Plus className="size-3" />
          <span className="@max-[20rem]:hidden">{t("ai.history.new")}</span>
        </button>
      </div>
      <div className="max-h-48 overflow-y-auto px-2 py-1.5 space-y-0.5">
        {sessions.length === 0 && (
          <p className="px-2 py-2 text-xs text-muted-foreground/60">{t("ai.history.empty")}</p>
        )}
        {sessions.map((s) => (
          <div
            key={s.id}
            className={cn(
              "group flex cursor-pointer items-center justify-between rounded-lg px-2 py-1.5 text-xs transition-colors",
              s.id === currentSessionId
                ? "bg-primary/10 text-primary ring-1 ring-inset ring-primary/15"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
            onClick={() => onSelectSession(s)}
          >
            <span className="truncate flex-1">{s.title}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDeleteSession(s.id);
              }}
              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
              title={t("ai.history.delete")}
            >
              <Trash2 className="size-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

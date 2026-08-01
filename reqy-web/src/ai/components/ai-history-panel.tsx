"use client";

import { Plus, Trash2 } from "lucide-react";
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
  return (
    <div className="border-b border-border bg-muted/20">
      <div className="flex items-center justify-between px-4 py-2">
        <span className="text-xs font-medium text-muted-foreground">Conversations</span>
        <button
          onClick={onNewSession}
          className="flex items-center gap-1 text-xs text-primary hover:underline"
        >
          <Plus className="size-3" /> Nouvelle
        </button>
      </div>
      <div className="max-h-48 overflow-y-auto px-2 pb-2 space-y-0.5">
        {sessions.length === 0 && (
          <p className="text-xs text-muted-foreground/60 px-2 py-2">
            Aucune conversation sauvegardée
          </p>
        )}
        {sessions.map((s) => (
          <div
            key={s.id}
            className={cn(
              "group flex items-center justify-between rounded-md px-2 py-1.5 cursor-pointer text-xs",
              s.id === currentSessionId
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent",
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
              title="Supprimer"
            >
              <Trash2 className="size-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

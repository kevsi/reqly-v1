"use client";

import { useMemo } from "react";
import { Plus, Trash2, MessageSquare, Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { cn } from "@/lib/utils";
import type { ConversationSession } from "@/src/ai/components/ai-sidebar-types";

interface AiHistoryPanelProps {
  sessions: ConversationSession[];
  currentSessionId: string | null;
  onSelectSession: (session: ConversationSession) => void;
  onDeleteSession: (id: string) => void;
  onNewSession: () => void;
}

function formatRelative(dateStr: string, t: TFunction): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t("common.justNow", { defaultValue: "À l'instant" });
  if (mins < 60) return t("common.minsAgo", { count: mins, defaultValue: `Il y a ${mins} min` });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("common.hoursAgo", { count: hours, defaultValue: `Il y a ${hours}h` });
  const days = Math.floor(hours / 24);
  if (days === 1) return t("common.yesterday", { defaultValue: "Hier" });
  if (days < 7) return t("common.daysAgo", { count: days, defaultValue: `Il y a ${days}j` });
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

function groupLabel(dateStr: string, t: TFunction): string {
  const d = new Date(dateStr);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const ts = d.getTime();
  if (ts >= startToday) return t("common.today", { defaultValue: "Aujourd'hui" });
  if (ts >= startToday - 86400000) return t("common.yesterday", { defaultValue: "Hier" });
  if (ts >= startToday - 7 * 86400000) return t("common.thisWeek", { defaultValue: "Cette semaine" });
  return t("common.older", { defaultValue: "Plus ancien" });
}

export function AiHistoryPanel({
  sessions,
  currentSessionId,
  onSelectSession,
  onDeleteSession,
  onNewSession,
}: AiHistoryPanelProps) {
  const { t } = useTranslation();

  const sorted = useMemo(
    () => [...sessions].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [sessions],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, ConversationSession[]>();
    for (const s of sorted) {
      const g = groupLabel(s.updatedAt, t);
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(s);
    }
    return Array.from(map.entries());
  }, [sorted, t]);

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-card px-3 py-2.5">
        <span className="text-xs font-semibold tracking-tight text-foreground">
          {t("ai.history.title", { defaultValue: "Historique" })}
        </span>
        <button
          onClick={onNewSession}
          title={t("ai.history.newTitle")}
          className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Plus className="size-3" />
          {t("ai.history.new", { defaultValue: "Nouvelle" })}
        </button>
      </div>

      <div className="px-2 py-2">
        {sessions.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <MessageSquare className="size-7 text-muted-foreground/30" />
            <p className="text-xs font-medium text-foreground">{t("ai.history.empty", { defaultValue: "Aucune conversation" })}</p>
            <p className="text-[11px] text-muted-foreground">Vos échanges apparaîtront ici, les plus récents en haut.</p>
          </div>
        )}

        {grouped.map(([label, items]) => (
          <div key={label} className="mb-3 last:mb-0">
            <div className="sticky top-0 z-10 -mx-2 mb-1 bg-background/80 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">
              {label}
            </div>
            <div className="space-y-1">
              {items.map((s) => {
                const isActive = s.id === currentSessionId;
                return (
                  <div
                    key={s.id}
                    onClick={() => onSelectSession(s)}
                    className={cn(
                      "group flex cursor-pointer flex-col gap-1 rounded-lg border px-2.5 py-2 text-xs transition-colors",
                      isActive
                        ? "border-primary/20 bg-primary/10 text-foreground shadow-sm"
                        : "border-transparent bg-card hover:border-border hover:bg-accent/50 text-foreground",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="line-clamp-2 flex-1 text-[13px] font-medium leading-snug">
                        {s.title}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteSession(s.id);
                        }}
                        className="mt-0.5 shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                        title={t("ai.history.delete")}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="size-3" />
                        {formatRelative(s.updatedAt, t)}
                      </span>
                      <span className="size-1 rounded-full bg-border" />
                      <span>{s.messages.length} messages</span>
                      {s.model && (
                        <>
                          <span className="size-1 rounded-full bg-border" />
                          <span className="truncate max-w-[10ch]">{s.model}</span>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

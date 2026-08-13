"use client";
import { AtSign, Folder, Globe, Zap } from "lucide-react";
import type { ContextAttachment, ContextAttachmentType } from "@/src/ai/agent/types";

const ICONS: Partial<Record<ContextAttachmentType, typeof Folder>> = {
  collection: Folder,
  request: Globe,
  environment: Zap,
};

interface Props {
  results: ContextAttachment[];
  onSelect: (a: ContextAttachment) => void;
}

export function AiContextPicker({ results, onSelect }: Props) {
  if (results.length === 0) return null;
  return (
    <div
      className="absolute bottom-full left-2 right-2 z-40 mb-1 max-h-48 overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-xl shadow-black/15"
      data-testid="ai-context-picker"
    >
      <p className="flex items-center gap-1.5 px-2 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">
        <AtSign className="size-2.5" />
        Contexte
      </p>
      {results.map((r) => {
        const Icon = ICONS[r.type] ?? Zap;
        return (
          <button
            key={r.id}
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(r);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent"
            data-testid={`ai-mention-${r.id}`}
          >
            <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground ring-1 ring-border/50">
              <Icon className="size-3" />
            </span>
            <span className="truncate flex-1">{r.label}</span>
            {r.detail && (
              <span className="truncate text-[10px] text-muted-foreground/60 max-w-[120px]">
                {r.detail}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

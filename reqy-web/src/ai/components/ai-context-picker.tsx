"use client";
import { Folder, Globe, Zap } from "lucide-react";
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
      className="absolute bottom-full left-2 right-2 z-40 max-h-48 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg shadow-black/10"
      data-testid="ai-context-picker"
    >
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
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
            data-testid={`ai-mention-${r.id}`}
          >
            <Icon className="size-3 shrink-0 text-muted-foreground" />
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

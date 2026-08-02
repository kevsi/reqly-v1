"use client";
import type { SlashCommand } from "@/src/ai/agent/commands";

interface Props {
  commands: SlashCommand[];
  onSelect: (name: string) => void;
}

export function AiCommandMenu({ commands, onSelect }: Props) {
  if (commands.length === 0) return null;
  return (
    <div
      className="absolute bottom-full left-2 right-2 z-40 max-h-48 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg shadow-black/10"
      data-testid="ai-command-menu"
    >
      {commands.map((c) => (
        <button
          key={c.name}
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(c.name);
          }}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
          data-testid={`ai-command-${c.name}`}
        >
          <span className="font-mono text-primary">/{c.name}</span>
          <span className="truncate flex-1 text-muted-foreground">{c.description}</span>
        </button>
      ))}
    </div>
  );
}

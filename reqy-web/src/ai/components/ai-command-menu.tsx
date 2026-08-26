"use client";
import { Command } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SlashCommand } from "@/src/ai/agent/commands";

interface Props {
  commands: SlashCommand[];
  onSelect: (name: string) => void;
  /** Index de l'item actif (navigation clavier pilotée par le composer). */
  activeIndex?: number;
}

export function AiCommandMenu({ commands, onSelect, activeIndex = -1 }: Props) {
  if (commands.length === 0) return null;
  return (
    <div
      className="absolute bottom-full left-2 right-2 z-40 mb-1 max-h-48 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-md"
      data-testid="ai-command-menu"
      role="listbox"
      aria-label="Commandes"
    >
      <p className="flex items-center gap-1.5 px-2 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">
        <Command className="size-2.5" />
        Commandes
      </p>
      {commands.map((c, i) => (
        <button
          key={c.name}
          type="button"
          role="option"
          aria-selected={i === activeIndex}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(c.name);
          }}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
            i === activeIndex ? "bg-accent" : "hover:bg-accent",
          )}
          data-testid={`ai-command-${c.name}`}
        >
          <span className="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary ring-1 ring-primary/20">
            /{c.name}
          </span>
          <span className="truncate flex-1 text-muted-foreground">{c.description}</span>
        </button>
      ))}
    </div>
  );
}

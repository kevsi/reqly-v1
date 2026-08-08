"use client";

import { useRef, useCallback, type FormEvent, type KeyboardEvent } from "react";
import { SendHorizontal, Square, X, Folder, Globe, Zap, Paperclip } from "lucide-react";
import { AiContextPicker } from "@/src/ai/components/ai-context-picker";
import { AiCommandMenu } from "@/src/ai/components/ai-command-menu";
import type { ContextAttachment, ContextAttachmentType } from "@/src/ai/agent/types";
import type { SlashCommand } from "@/src/ai/agent/commands";

const ATTACH_ICONS: Partial<Record<ContextAttachmentType, typeof Folder>> = {
  collection: Folder,
  request: Globe,
  environment: Zap,
};

interface AiChatInputProps {
  value: string;
  onValueChange: (value: string) => void;
  onSend: () => void;
  onStop?: () => void;
  isLoading?: boolean;
  placeholder?: string;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
  attachments?: ContextAttachment[];
  onRemoveAttachment?: (id: string) => void;
  commandResults?: SlashCommand[];
  mentionResults?: ContextAttachment[];
  onSelectCommand?: (name: string) => void;
  onSelectMention?: (a: ContextAttachment) => void;
}

export function AiChatInput({
  value,
  onValueChange,
  onSend,
  onStop,
  isLoading = false,
  placeholder = "Demande à l'assistant… (/ commandes · @ contexte)",
  inputRef,
  attachments = [],
  onRemoveAttachment,
  commandResults,
  mentionResults,
  onSelectCommand,
  onSelectMention,
}: AiChatInputProps) {
  const internalRef = useRef<HTMLTextAreaElement>(null);
  const ref = inputRef ?? internalRef;

  // Auto-resize the textarea as content grows (max ~5 lines)
  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onValueChange(e.target.value);
      const el = e.target;
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    },
    [onValueChange],
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter = send, Shift+Enter = newline
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey) {
      e.preventDefault();
      if (!value.trim() || isLoading) return;
      onSend();
      // Reset height
      if (ref.current) ref.current.style.height = "auto";
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim() || isLoading) return;
    onSend();
    if (ref.current) ref.current.style.height = "auto";
  };

  return (
    <div className="border-t border-border/60 p-3 shrink-0 bg-background/80">
      {/* Attachment chips */}
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {attachments.map((a) => {
            const Icon = ATTACH_ICONS[a.type] ?? Paperclip;
            return (
              <span
                key={a.id}
                className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/8 px-2 py-0.5 text-[10px] text-primary"
              >
                <Icon className="size-2.5" />
                {a.label}
                <button
                  type="button"
                  onClick={() => onRemoveAttachment?.(a.id)}
                  className="ml-0.5 opacity-60 hover:opacity-100 transition-opacity"
                  aria-label={`Retirer ${a.label}`}
                >
                  <X className="size-2.5" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      <form onSubmit={handleSubmit} className="relative">
        {/* Slash command menu */}
        {onSelectCommand && (
          <AiCommandMenu commands={commandResults ?? []} onSelect={onSelectCommand} />
        )}
        {/* @-mention picker */}
        {onSelectMention && (
          <AiContextPicker results={mentionResults ?? []} onSelect={onSelectMention} />
        )}

        <div
          className="flex items-end gap-1.5 rounded-xl border border-input bg-card shadow-xs
                     transition-[color,box-shadow] focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]"
        >
          <textarea
            ref={ref}
            value={value}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={isLoading}
            rows={1}
            className="min-h-[36px] max-h-[120px] flex-1 resize-none overflow-y-auto
                       bg-transparent px-3 py-2 text-sm leading-snug outline-none
                       placeholder:text-muted-foreground/60
                       disabled:cursor-not-allowed disabled:opacity-50"
          />

          <div className="flex shrink-0 items-center gap-0.5 pb-1 pr-1.5">
            {isLoading && onStop ? (
              <button
                type="button"
                onClick={onStop}
                aria-label="Arrêter la génération"
                title="Arrêter"
                className="flex size-7 items-center justify-center rounded-lg border border-destructive/30
                           text-destructive transition-colors hover:bg-destructive/10"
                data-testid="ai-stop"
              >
                <Square className="size-3" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!value.trim() || isLoading}
                aria-label="Envoyer"
                className="flex size-7 items-center justify-center rounded-lg
                           bg-gradient-to-br from-primary to-primary/80 text-primary-foreground
                           shadow-sm transition-[transform,opacity] duration-150
                           hover:brightness-105 active:scale-95
                           disabled:opacity-35 disabled:pointer-events-none"
              >
                <SendHorizontal className="size-3.5" />
              </button>
            )}
          </div>
        </div>
      </form>

      {/* Hint row */}
      <p className="mt-1.5 text-center text-[10px] text-muted-foreground/45">
        Entrée pour envoyer · Shift+Entrée pour aller à la ligne · ⌘I pour fermer
      </p>
    </div>
  );
}

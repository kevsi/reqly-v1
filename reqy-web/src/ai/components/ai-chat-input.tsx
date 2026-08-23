"use client";

import { useRef, useCallback, useState, type FormEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { SendHorizontal, Square, X, Folder, Globe, Zap, Paperclip, Check } from "lucide-react";
import { cn } from "@/lib/utils";
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
  placeholder,
  inputRef,
  attachments = [],
  onRemoveAttachment,
  commandResults,
  mentionResults,
  onSelectCommand,
  onSelectMention,
}: AiChatInputProps) {
  const { t } = useTranslation();
  const inputPlaceholder = placeholder ?? t("aiChat.placeholder");
  const internalRef = useRef<HTMLTextAreaElement>(null);
  const ref = inputRef ?? internalRef;
  const [justSent, setJustSent] = useState(false);

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

  const triggerSend = useCallback(() => {
    if (!value.trim() || isLoading) return;
    onSend();
    setJustSent(true);
    setTimeout(() => setJustSent(false), 500);
    if (ref.current) ref.current.style.height = "auto";
  }, [value, isLoading, onSend, ref]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey) {
      e.preventDefault();
      triggerSend();
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    triggerSend();
  };

  return (
    <div className="shrink-0 border-t border-border/60 bg-gradient-to-b from-transparent to-background/80 p-3 pt-2.5 backdrop-blur-sm">
      {/* Attachment chips */}
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {attachments.map((a) => {
            const Icon = ATTACH_ICONS[a.type] ?? Paperclip;
            return (
              <span
                key={a.id}
                className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"
              >
                <Icon className="size-2.5" />
                {a.label}
                <button
                  type="button"
                  onClick={() => onRemoveAttachment?.(a.id)}
                  className="ml-0.5 opacity-60 hover:opacity-100 transition-opacity"
                  aria-label={t("aiChat.removeAttachment", { label: a.label })}
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
          className="flex items-end gap-1.5 rounded-xl border border-border bg-card/70 shadow-[0_1px_2px] shadow-black/[0.04] backdrop-blur-sm
                     transition-[color,box-shadow,border-color] focus-within:border-primary/40 focus-within:shadow-[0_0_0_3px] focus-within:shadow-ring/25"
        >
          <textarea
            ref={ref}
            value={value}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={inputPlaceholder}
            disabled={isLoading}
            rows={1}
            className="min-h-[38px] max-h-[120px] flex-1 resize-none overflow-y-auto
                       bg-transparent px-3 py-2 text-sm leading-snug outline-none
                       placeholder:text-muted-foreground/60
                       disabled:cursor-not-allowed disabled:opacity-50"
          />

          <div className="flex shrink-0 items-center gap-0.5 pb-1 pr-1.5">
            {isLoading && onStop ? (
              <button
                type="button"
                onClick={onStop}
                aria-label={t("aiChat.stopGenerating")}
                title={t("aiChat.stop")}
                className="flex size-7 items-center justify-center rounded-lg border border-destructive/30
                           text-destructive transition-colors hover:bg-destructive/10"
                data-testid="ai-stop"
              >
                <Square className="size-3" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={(!value.trim() && !justSent) || isLoading}
                aria-label={t("aiChat.send")}
                className={cn(
                  "flex size-7 items-center justify-center rounded-lg text-primary-foreground shadow-sm transition-all duration-200",
                  justSent
                    ? "bg-success/80 scale-90"
                    : "bg-primary hover:brightness-110 hover:shadow-[0_2px_10px_-2px] hover:shadow-primary/50 active:scale-95",
                  "disabled:opacity-35 disabled:pointer-events-none",
                )}
              >
                {justSent ? (
                  <Check className="size-3.5" />
                ) : (
                  <SendHorizontal className="size-3.5" />
                )}
              </button>
            )}
          </div>
        </div>
      </form>

      {/* Hint row */}
      <p className="mt-1.5 flex h-3.5 items-center justify-center gap-1.5 text-[10px] text-muted-foreground/45">
        {isLoading ? (
          <span className="text-primary/60">{t("aiChat.generatingResponse")}</span>
        ) : (
          t("aiChat.hint")
        )}
      </p>
    </div>
  );
}

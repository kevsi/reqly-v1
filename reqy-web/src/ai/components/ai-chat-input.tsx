"use client";

import { useRef, type FormEvent } from "react";
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
  /** Texte courant de l'input */
  value: string;
  /** Change handler — reçoit la nouvelle valeur */
  onValueChange: (value: string) => void;
  /** Callback quand le formulaire est soumis (Enter / bouton) */
  onSend: () => void;
  /** Stop la génération en cours */
  onStop?: () => void;
  /** Affiche le spinner loading dans le bouton */
  isLoading?: boolean;
  /** Texte du placeholder */
  placeholder?: string;
  /** Ref forwardée vers l'input natif. Si absent, une ref interne est créée. */
  inputRef?: React.RefObject<HTMLInputElement | null>;
  /** Attachements de contexte affichés en chips */
  attachments?: ContextAttachment[];
  onRemoveAttachment?: (id: string) => void;
  /** Résultats du menu de commandes slash */
  commandResults?: SlashCommand[];
  /** Résultats du picker @-mentions */
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
  placeholder = "Demande à l'assistant… (/ pour les commandes, @ pour le contexte)",
  inputRef,
  attachments = [],
  onRemoveAttachment,
  commandResults,
  mentionResults,
  onSelectCommand,
  onSelectMention,
}: AiChatInputProps) {
  const internalRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? internalRef;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim() || isLoading) return;
    onSend();
  };

  return (
    <div className="border-t border-border p-3 shrink-0">
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {attachments.map((a) => {
            const Icon = ATTACH_ICONS[a.type] ?? Paperclip;
            return (
              <span
                key={a.id}
                className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary ring-1 ring-primary/15"
              >
                <Icon className="size-2.5" />
                {a.label}
                <button
                  type="button"
                  onClick={() => onRemoveAttachment?.(a.id)}
                  className="ml-0.5 opacity-60 hover:opacity-100"
                  aria-label={`Retirer ${a.label}`}
                >
                  <X className="size-2.5" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="relative flex items-center rounded-lg border border-input bg-transparent shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]"
      >
        {onSelectCommand && (
          <AiCommandMenu commands={commandResults ?? []} onSelect={onSelectCommand} />
        )}
        {onSelectMention && (
          <AiContextPicker results={mentionResults ?? []} onSelect={onSelectMention} />
        )}

        <input
          ref={ref}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          placeholder={placeholder}
          disabled={isLoading}
          className="flex-1 min-w-0 bg-transparent px-3 py-1.5 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!value.trim() || isLoading}
          aria-label="Envoyer"
          className="flex size-8 mr-1.5 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-sm transition-all hover:shadow-md hover:brightness-105 active:scale-95 disabled:opacity-40 disabled:pointer-events-none shrink-0"
        >
          <SendHorizontal className="size-4" />
        </button>
        {isLoading && onStop && (
          <button
            type="button"
            onClick={onStop}
            aria-label="Arrêter"
            title="Arrêter la génération"
            className="flex size-8 items-center justify-center rounded-lg text-destructive hover:bg-destructive/10"
            data-testid="ai-stop"
          >
            <Square className="size-3.5" />
          </button>
        )}
      </form>
      <p className="text-[10px] text-muted-foreground/50 mt-1.5 text-center">
        L&apos;IA n&apos;agit que sur demande explicite
      </p>
    </div>
  );
}

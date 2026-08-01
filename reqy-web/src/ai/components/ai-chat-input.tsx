"use client";

import { useRef, type FormEvent } from "react";
import { Send, Loader2 } from "lucide-react";

interface AiChatInputProps {
  /** Texte courant de l'input */
  value: string;
  /** Change handler — reçoit la nouvelle valeur */
  onValueChange: (value: string) => void;
  /** Callback quand le formulaire est soumis (Enter / bouton) */
  onSend: () => void;
  /** Affiche le spinner loading dans le bouton */
  isLoading?: boolean;
  /** Texte du placeholder */
  placeholder?: string;
  /** Ref forwardée vers l'input natif. Si absent, une ref interne est créée. */
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

export function AiChatInput({
  value,
  onValueChange,
  onSend,
  isLoading = false,
  placeholder = "Demande à l'assistant…",
  inputRef,
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
      <form
        onSubmit={handleSubmit}
        className="flex items-center rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]"
      >
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
          className="flex size-8 mr-1.5 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50 disabled:pointer-events-none transition-colors shrink-0"
        >
          {isLoading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
        </button>
      </form>
      <p className="text-[10px] text-muted-foreground/50 mt-1.5 text-center">
        L&apos;IA n&apos;agit que sur demande explicite
      </p>
    </div>
  );
}

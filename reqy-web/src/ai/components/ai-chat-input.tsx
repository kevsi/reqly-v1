"use client";

import {
  useRef,
  useCallback,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ChangeEvent,
} from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowUp,
  Square,
  X,
  Folder,
  Globe,
  Zap,
  Paperclip,
  Check,
  FileText,
} from "lucide-react";
import { cn, formatBytes } from "@/lib/utils";
import { AiContextPicker } from "@/src/ai/components/ai-context-picker";
import { AiCommandMenu } from "@/src/ai/components/ai-command-menu";
import type { ContextAttachment, ContextAttachmentType } from "@/src/ai/agent/types";
import type { FileAttachment } from "@/src/ai/components/ai-sidebar-types";
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
  /** Fichiers joints via « Joindre » (lecture texte côté client). */
  files?: FileAttachment[];
  onAddFiles?: (files: FileList) => void;
  onRemoveFile?: (id: string) => void;
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
  files = [],
  onAddFiles,
  onRemoveFile,
  commandResults,
  mentionResults,
  onSelectCommand,
  onSelectMention,
}: AiChatInputProps) {
  const { t } = useTranslation();
  const inputPlaceholder = placeholder ?? t("aiChat.placeholder");
  const internalRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? internalRef;
  const [justSent, setJustSent] = useState(false);

  // M5 — menu ouvert (commandes ou mentions) : Enter/Tab sélectionnent,
  // ↑/↓ naviguent, au lieu d'envoyer le texte brut.
  const openMenu: "commands" | "mentions" | null =
    commandResults && commandResults.length > 0
      ? "commands"
      : mentionResults && mentionResults.length > 0
        ? "mentions"
        : null;
  const menuCount =
    openMenu === "commands"
      ? (commandResults?.length ?? 0)
      : openMenu === "mentions"
        ? (mentionResults?.length ?? 0)
        : 0;
  // Reset de l'index quand le menu change — pattern "adjust state during render".
  const menuKey = `${openMenu ?? ""}:${menuCount}`;
  const [menuState, setMenuState] = useState({ key: "", index: 0 });
  if (menuState.key !== menuKey) {
    setMenuState({ key: menuKey, index: 0 });
  }
  const menuIndex = menuState.index;
  const setMenuIndex = (updater: (i: number) => number) =>
    setMenuState((s) => ({ ...s, index: updater(s.index) }));

  // Auto-resize the textarea as content grows (max ~5 lines)
  const handleInput = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      onValueChange(e.target.value);
      const el = e.target;
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    },
    [onValueChange],
  );

  const canSend = Boolean(value.trim()) && !isLoading;

  const triggerSend = useCallback(() => {
    if (!canSend) return;
    onSend();
    setJustSent(true);
    setTimeout(() => setJustSent(false), 500);
    if (ref.current) ref.current.style.height = "auto";
  }, [canSend, onSend, ref]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // P1.2 — Escape referme le menu ouvert SANS propager à la sidebar
    // (le listener fenêtre fermerait sinon tout le panneau).
    if (e.key === "Escape" && openMenu && menuCount > 0) {
      e.preventDefault();
      e.stopPropagation();
      const idx = Math.max(value.lastIndexOf("/"), value.lastIndexOf("@"));
      if (idx >= 0) onValueChange(value.slice(0, idx));
      return;
    }
    // M5 — navigation clavier du menu ouvert avant tout envoi.
    if (openMenu && menuCount > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMenuIndex((i) => (i + 1) % menuCount);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMenuIndex((i) => (i - 1 + menuCount) % menuCount);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        if (openMenu === "commands") {
          const cmd = commandResults?.[menuIndex];
          if (cmd) onSelectCommand?.(cmd.name);
        } else {
          const mention = mentionResults?.[menuIndex];
          if (mention) onSelectMention?.(mention);
        }
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey) {
      e.preventDefault();
      triggerSend();
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) onAddFiles?.(e.target.files);
    e.target.value = "";
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    triggerSend();
  };

  return (
    <div className="shrink-0 px-3 pb-4 pt-1">
      <form onSubmit={handleSubmit} className="relative">
        {/* Slash command menu */}
        {onSelectCommand && (
          <AiCommandMenu
            commands={commandResults ?? []}
            onSelect={onSelectCommand}
            activeIndex={openMenu === "commands" ? menuIndex : -1}
          />
        )}
        {/* @-mention picker */}
        {onSelectMention && (
          <AiContextPicker
            results={mentionResults ?? []}
            onSelect={onSelectMention}
            activeIndex={openMenu === "mentions" ? menuIndex : -1}
          />
        )}

        {/* Carte composer — style Claude */}
        <div
          className={cn(
            "rounded-lg border border-border bg-card px-3 pb-2 pt-2",
            "transition-colors focus-within:border-ring/60",
          )}
        >
          {/* Chips : contexte (@) + fichiers joints — scrollables si débordement */}
          {(attachments.length > 0 || files.length > 0) && (
            <div className="mb-1.5 flex max-h-24 flex-wrap gap-1 overflow-y-auto">
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
              {files.map((f) => {
                const unreadable =
                  f.unreadableReason === "too_large"
                    ? t("aiChat.fileTooLarge", {
                        max: Math.ceil(200_000 / 1024),
                      })
                    : f.unreadableReason === "binary"
                      ? t("aiChat.fileBinary")
                      : null;
                return (
                  <span
                    key={f.id}
                    className={cn(
                      "inline-flex max-w-[220px] items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]",
                      unreadable
                        ? "border-warning/40 bg-warning/10 text-warning"
                        : "border-border/70 bg-muted/60 text-muted-foreground",
                    )}
                  >
                    <FileText className="size-2.5 shrink-0" />
                    <span className="truncate">{f.name}</span>
                    {unreadable ? (
                      <span className="shrink-0" title={unreadable}>
                        · {unreadable}
                      </span>
                    ) : (
                      <span className="shrink-0 opacity-50">· {formatBytes(f.size)}</span>
                    )}
                    <button
                      type="button"
                      onClick={() => onRemoveFile?.(f.id)}
                      className="ml-0.5 shrink-0 opacity-60 hover:opacity-100 transition-opacity"
                      aria-label={t("aiChat.removeAttachment", { label: f.name })}
                    >
                      <X className="size-2.5" />
                    </button>
                  </span>
                );
              })}
            </div>
          )}

          <textarea
            ref={ref}
            value={value}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={inputPlaceholder}
            rows={1}
            className="min-h-[44px] max-h-[120px] w-full resize-none overflow-y-auto
                       bg-transparent py-1 text-sm leading-6 outline-none
                       placeholder:text-muted-foreground/60
                       disabled:cursor-not-allowed disabled:opacity-50"
          />

          {/* Barre d'actions — Joindre à gauche, envoi à droite */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title={t("aiChat.attachTitle")}
              >
                <Paperclip className="size-3.5" />
                <span>{t("aiChat.attach")}</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileChange}
                className="hidden"
                aria-hidden
                tabIndex={-1}
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="hidden text-[11px] text-muted-foreground/50 sm:block">
                {t("aiChat.enterToSend")}
              </span>
              {isLoading && onStop ? (
                <button
                  type="button"
                  onClick={onStop}
                  aria-label={t("aiChat.stopGenerating")}
                  title={t("aiChat.stop")}
                  className="flex size-8 items-center justify-center rounded-lg border border-destructive/30
                             text-destructive transition-colors hover:bg-destructive/10"
                  data-testid="ai-stop"
                >
                  <Square className="size-3" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!canSend && !justSent}
                  aria-label={t("aiChat.send")}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-lg transition-colors duration-200",
                    justSent
                      ? "bg-success/80 text-white"
                      : canSend
                        ? "bg-primary text-primary-foreground hover:brightness-110"
                        : "bg-muted text-muted-foreground",
                    "disabled:pointer-events-none",
                  )}
                >
                  {justSent ? <Check className="size-4" /> : <ArrowUp className="size-4" />}
                </button>
              )}
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

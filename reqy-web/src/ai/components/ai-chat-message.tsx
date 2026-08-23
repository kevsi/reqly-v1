"use client";

import { Bot, UserRound, Copy, Check, RotateCcw, SquarePen, Gauge } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  AssistantStepsRenderer,
  toAssistantSteps,
} from "@/src/ai/components/assistant-steps-renderer";
import { ProgressiveMarkdown } from "@/src/ai/components/progressive-markdown";
import type { ChatMessage } from "@/src/ai/components/ai-sidebar-types";
import type { ParsedCodeRequest } from "@/src/ai/agent/code-request";
import { formatTokens } from "@/src/ai/agent/usage";

interface AiChatMessageProps {
  message: ChatMessage;
  index: number;
  editingIndex: number | null;
  editingText: string;
  copiedIndex: number | null;
  onEditStart: (index: number, content: string) => void;
  onCopy: (content: string, index: number) => void;
  onRetry: () => void;
  onEditCancel: () => void;
  onEditConfirm: () => void;
  onEditingTextChange: (text: string) => void;
  onConfirm?: (stepId: string, confirmed: boolean) => void;
  /** Appelé quand le texte affiché évolue pendant la révélation progressive (auto-scroll). */
  onTypingUpdate?: () => void;
  onExecuteRequest?: (request: ParsedCodeRequest) => void;
}

export function AiChatMessage({
  message,
  index,
  editingIndex,
  editingText,
  copiedIndex,
  onEditStart,
  onCopy,
  onRetry,
  onEditCancel,
  onEditConfirm,
  onEditingTextChange,
  onConfirm,
  onTypingUpdate,
  onExecuteRequest,
}: AiChatMessageProps) {
  const { t } = useTranslation();
  const isAssistant = message.role === "assistant";
  const usageLabel = isAssistant && message.usage ? formatTokens(message.usage) : "";
  const hasLiveSteps =
    isAssistant &&
    (message.steps ?? []).some((s) => s.status === "in_progress" || s.status === "pending");
  // La timeline porte déjà le statut lorsqu’une étape active existe.
  // La bulle ne doit afficher un second indicateur que pendant l’attente initiale,
  // avant la création de la première étape.
  const isAwaitingResponse =
    isAssistant && message.phase === "awaiting_response" && !message.content;
  const isToolCalling = isAssistant && message.phase === "tool_calling" && !message.content;
  const isLive = isAssistant && (hasLiveSteps || isAwaitingResponse || isToolCalling);
  const showLiveStatusInBubble =
    isAssistant && !message.content && !hasLiveSteps && (isToolCalling || isAwaitingResponse);
  // Pas de bulle pour un message assistant terminé sans contenu (mode plan,
  // erreur déjà visible dans les étapes, etc.) — plus de bulle vide.
  const hasBubbleContent = isAssistant
    ? showLiveStatusInBubble || !!message.content
    : !!message.content;

  return (
    <div className="group relative">
      {/* Process steps timeline (assistant only) — mode "timeline" : toutes les
          étapes restent visibles avec leur statut (Through…, exécutions, et les
          boutons Confirmer/Annuler pour les actions en attente). Une fois la
          réponse terminée, la timeline se replie en une ligne résumée. */}
      {isAssistant && message.steps && message.steps.length > 0 && (
        <div className="mb-1.5">
          <AssistantStepsRenderer
            steps={toAssistantSteps(message.steps)}
            mode="timeline"
            onConfirm={onConfirm}
            collapsible
          />
        </div>
      )}

      {/* Attachment chips (user only) */}
      {message.role === "user" && message.attachments && message.attachments.length > 0 && (
        <div className="mb-1.5 flex flex-wrap justify-end gap-1 pr-8">
          {message.attachments.map((a) => (
            <span
              key={a.id}
              className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary ring-1 ring-primary/20 backdrop-blur-sm"
            >
              {a.type} → {a.label}
            </span>
          ))}
        </div>
      )}

      {/* Message row — avatar + bulle */}
      <div
        className={cn(
          "flex items-start gap-2",
          message.role === "user" ? "flex-row-reverse" : "flex-row",
        )}
      >
        {/* Avatar */}
        <div
          className={cn(
            "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ring-1 transition-shadow",
            isAssistant
              ? isLive
                ? "bg-primary text-primary-foreground ring-primary/40 shadow-[0_0_14px_-2px] shadow-primary/50"
                : "bg-gradient-to-br from-primary/25 to-primary/10 text-primary ring-primary/25"
              : "bg-muted text-muted-foreground ring-border/70",
          )}
          aria-hidden
        >
          {isLive ? (
            <span className="relative flex size-3 items-center justify-center">
              <span className="absolute size-3 rounded-full border border-current/35" />
              <span className="size-1.5 rounded-full bg-current" />
            </span>
          ) : isAssistant ? (
            <Bot className="size-3.5" />
          ) : (
            <UserRound className="size-3.5" />
          )}
        </div>

        {/* Bulle de message */}
        {hasBubbleContent && (
          <div
            className={cn(
              "max-w-[85%] text-sm leading-relaxed",
              message.role === "user"
                ? "rounded-2xl rounded-br-md bg-gradient-to-br from-primary to-primary/85 px-3.5 py-2 text-primary-foreground shadow-[0_4px_14px_-4px] shadow-primary/40"
                : "rounded-2xl rounded-tl-md border border-border/60 bg-card/90 px-3.5 py-2 text-foreground shadow-[0_1px_3px] shadow-black/[0.03]",
            )}
          >
            {isAssistant ? (
              showLiveStatusInBubble ? (
                <span
                  className="flex items-center gap-2 py-0.5"
                  aria-live="polite"
                  aria-label={t("ai.chatMessage.generating")}
                >
                  <span className="relative flex size-3 items-center justify-center text-primary">
                    <span className="absolute size-3 animate-ping rounded-full border border-current/35" />
                    <span className="size-1.5 rounded-full bg-current" />
                  </span>
                  <span className="text-xs text-muted-foreground/75">
                    {isAwaitingResponse
                      ? t("ai.chatMessage.generating")
                      : t("ai.chatMessage.thinking")}
                  </span>
                </span>
              ) : (
                <ProgressiveMarkdown
                  content={message.content}
                  onTextChange={onTypingUpdate}
                  onExecuteRequest={onExecuteRequest}
                />
              )
            ) : (
              message.content
            )}
          </div>
        )}
      </div>

      {/* Usage badge (assistant only) */}
      {usageLabel && (
        <div
          className="mt-1 flex items-center gap-1 pl-8 text-[10px] text-muted-foreground/60"
          data-testid="ai-usage-badge"
        >
          <Gauge className="size-3" />
          {usageLabel}
        </div>
      )}

      {/* Actions — barre pilule sous le message, révélée au survol */}
      <div
        className={cn(
          "mt-1 flex",
          message.role === "user" ? "justify-end pr-6" : "justify-start pl-6",
          "opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-within:opacity-100",
        )}
      >
        <div className="inline-flex items-center gap-0.5 rounded-full border border-border/70 bg-background/90 p-0.5 shadow-sm backdrop-blur-md">
          {message.role === "user" ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onEditStart(index, message.content)}
              className="size-6 rounded-full [&_svg]:size-3 text-muted-foreground hover:text-foreground"
              title={t("ai.chatMessage.edit")}
            >
              <SquarePen className="size-3" />
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onCopy(message.content, index)}
                className="size-6 rounded-full [&_svg]:size-3 text-muted-foreground hover:text-foreground"
                title={t("ai.chatMessage.copy")}
              >
                {copiedIndex === index ? (
                  <Check className="size-3 text-success" />
                ) : (
                  <Copy className="size-3" />
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onRetry}
                className="size-6 rounded-full [&_svg]:size-3 text-muted-foreground hover:text-foreground"
                title={t("ai.chatMessage.retry")}
              >
                <RotateCcw className="size-3" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Editing overlay */}
      {editingIndex === index && (
        <div className="mt-2 space-y-1.5">
          <Textarea
            value={editingText}
            onChange={(e) => onEditingTextChange(e.target.value)}
            className="w-full resize-none focus-visible:ring-2 focus-visible:ring-primary"
            rows={3}
            autoFocus
          />
          <div className="flex justify-end gap-1.5">
            <Button
              type="button"
              variant="ghost"
              onClick={onEditCancel}
              className="h-auto px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Annuler
            </Button>
            <Button
              type="button"
              variant="default"
              onClick={onEditConfirm}
              disabled={!editingText.trim()}
              className="h-auto px-3 py-1 text-xs"
            >
              Envoyer
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

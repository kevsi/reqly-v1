"use client";

import { Bot, UserRound, Copy, Check, RotateCcw, SquarePen, Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  AssistantStepsRenderer,
  toAssistantSteps,
} from "@/src/ai/components/assistant-steps-renderer";
import { AiMarkdown } from "@/src/ai/components/ai-markdown";
import type { ChatMessage } from "@/src/ai/components/ai-sidebar-types";
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
}: AiChatMessageProps) {
  const isAssistant = message.role === "assistant";
  const usageLabel = isAssistant && message.usage ? formatTokens(message.usage) : "";
  const isLive =
    isAssistant &&
    (message.steps ?? []).some((s) => s.status === "in_progress" || s.status === "pending");

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
        <div className="mb-1.5 flex flex-wrap gap-1 pl-9">
          {message.attachments.map((a) => (
            <span
              key={a.id}
              className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary ring-1 ring-primary/15"
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
            "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ring-1",
            isAssistant
              ? isLive
                ? "bg-primary text-primary-foreground ring-primary/40 shadow-[0_0_12px] shadow-primary/40"
                : "bg-gradient-to-br from-primary/20 to-primary/10 text-primary ring-primary/20"
              : "bg-muted text-muted-foreground ring-border/70",
          )}
          aria-hidden
        >
          {/* Pendant qu'un step est en cours, on affiche 3 points animés sur le robot */}
          {isLive ? (
            <span className="flex items-center gap-0.5">
              <span className="size-1 rounded-full bg-current animate-bounce [animation-delay:0ms]" />
              <span className="size-1 rounded-full bg-current animate-bounce [animation-delay:150ms]" />
              <span className="size-1 rounded-full bg-current animate-bounce [animation-delay:300ms]" />
            </span>
          ) : isAssistant ? (
            <Bot className="size-3.5" />
          ) : (
            <UserRound className="size-3.5" />
          )}
        </div>

        {/* Bulle de message */}
        <div
          className={cn(
            "max-w-[85%] text-sm leading-relaxed",
            message.role === "user"
              ? "rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-primary-foreground shadow-[0_2px_8px_-2px] shadow-primary/40"
              : "rounded-2xl rounded-tl-md border border-border/60 bg-card/80 px-3.5 py-2 text-foreground",
            isAssistant && !message.content && message.steps && message.steps.length > 0
              ? "min-h-[2px] py-0.5 border-dashed border-primary/30"
              : "",
          )}
        >
          {isAssistant ? <AiMarkdown content={message.content} /> : message.content}
        </div>
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
          message.role === "user" ? "justify-end pr-8" : "justify-start pl-8",
          "opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-within:opacity-100",
        )}
      >
        <div className="inline-flex items-center gap-0.5 rounded-full border border-border/70 bg-background/90 p-0.5 shadow-sm backdrop-blur">
          {message.role === "user" ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onEditStart(index, message.content)}
              className="size-6 rounded-full [&_svg]:size-3 text-muted-foreground hover:text-foreground"
              title="Modifier"
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
                title="Copier la réponse"
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
                title="Réessayer"
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

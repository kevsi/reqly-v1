"use client";

import { Copy, Check, Edit3, RotateCcw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { AssistantStepsRenderer, toAssistantSteps } from "@/src/ai/components/assistant-steps-renderer";
import type { ChatMessage } from "@/src/ai/components/ai-sidebar-types";

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
  return (
    <div className="group relative">
      {/* Process steps timeline (assistant only) */}
      {message.role === "assistant" && message.steps && message.steps.length > 0 && (
        <AssistantStepsRenderer steps={toAssistantSteps(message.steps)} onConfirm={onConfirm} />
      )}

      {/* Message bubble */}
      <div
        className={cn(
          "rounded-xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap",
          message.role === "user"
            ? "bg-primary/10 text-foreground ml-6"
            : "bg-muted/30 text-foreground mr-6 border border-border/50",
          message.role === "assistant" &&
            !message.content &&
            message.steps &&
            message.steps.length > 0
            ? "min-h-[2px] py-0.5 border-dashed border-primary/30"
            : "",
        )}
      >
        {message.content}
      </div>

      {/* Actions */}
      <div
        className={cn(
          "absolute top-1 hidden group-hover:flex gap-0.5",
          message.role === "user" ? "right-0" : "left-0",
        )}
      >
        {message.role === "user" ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onEditStart(index, message.content)}
            className="size-6 rounded [&_svg]:size-3 text-muted-foreground hover:text-foreground"
            title="Modifier"
          >
            <Edit3 className="size-3" />
          </Button>
        ) : (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onCopy(message.content, index)}
              className="size-6 rounded [&_svg]:size-3 text-muted-foreground hover:text-foreground"
              title="Copier"
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
              className="size-6 rounded [&_svg]:size-3 text-muted-foreground hover:text-foreground"
              title="Re-essayer"
            >
              <RotateCcw className="size-3" />
            </Button>
          </>
        )}
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
          <div className="flex gap-1.5 justify-end">
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

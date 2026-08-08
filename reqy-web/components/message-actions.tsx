"use client";

import { useState } from "react";
import { Copy, RotateCcw, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

interface MessageActionsProps {
  messageId: string;
  content: string;
  role: "user" | "assistant";
  onEdit?: () => void;
  onRetry?: () => void;
  onCopy?: () => void;
  isEditing?: boolean;
  className?: string;
}

export function MessageActions({
  content,
  role,
  onEdit,
  onRetry,
  onCopy,
  isEditing,
  className,
}: MessageActionsProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      toast({
        title: "Message copié",
        description: "Le contenu a été copié dans le presse-papiers.",
      });
      setTimeout(() => setCopied(false), 2000);
      onCopy?.();
    } catch (_error) {
      toast({
        title: "Erreur",
        description: "Impossible de copier le message.",
        variant: "destructive",
      });
    }
  };

  const handleEdit = () => {
    if (role === "user") {
      onEdit?.();
    }
  };

  const handleRetry = () => {
    if (role === "assistant") {
      onRetry?.();
    }
  };

  return (
    <div
      className={cn(
        "flex items-center gap-1 opacity-0 transition-all duration-200 group-hover/message:opacity-100",
        "absolute -top-8 right-0 z-10",
        className,
      )}
    >
      {/* Copy button - always show for assistant messages */}
      {role === "assistant" && (
        <button
          onClick={handleCopy}
          disabled={isEditing}
          title="Copier le message"
          className={cn(
            "flex size-7 items-center justify-center rounded-md transition-all",
            "text-muted-foreground hover:text-foreground hover:bg-muted",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            copied && "text-green-600 bg-green-100/30 dark:text-green-400 dark:bg-green-500/15",
          )}
        >
          <Copy className="size-4" />
        </button>
      )}

      {/* Edit button - only for user messages */}
      {role === "user" && (
        <button
          onClick={handleEdit}
          disabled={isEditing}
          title="Éditer le message"
          className={cn(
            "flex size-7 items-center justify-center rounded-md transition-all",
            "text-muted-foreground hover:text-foreground hover:bg-muted",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            isEditing && "bg-muted text-foreground",
          )}
        >
          <Pencil className="size-4" />
        </button>
      )}

      {/* Retry button - only for assistant messages */}
      {role === "assistant" && (
        <button
          onClick={handleRetry}
          disabled={isEditing}
          title="Régénérer la réponse"
          className={cn(
            "flex size-7 items-center justify-center rounded-md transition-all",
            "text-muted-foreground hover:text-foreground hover:bg-muted",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          <RotateCcw className="size-4" />
        </button>
      )}
    </div>
  );
}

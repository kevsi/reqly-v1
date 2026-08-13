"use client";

import { useState, useEffect } from "react";
import { Sparkles, Loader2, AlertCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

const SUGGESTIONS = [
  "graphql.aiDialog.suggestion1",
  "graphql.aiDialog.suggestion2",
  "graphql.aiDialog.suggestion3",
  "graphql.aiDialog.suggestion4",
] as const;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (description: string) => void | Promise<void>;
  loading?: boolean;
  error?: string | null;
  hasSchema?: boolean;
}

export function GraphqlAIDialog({
  open,
  onOpenChange,
  onSubmit,
  loading = false,
  error = null,
  hasSchema = false,
}: Props) {
  const { t } = useTranslation();
  const [description, setDescription] = useState("");

  // Reset on close.
  useEffect(() => {
    if (!open) {
      const timer = window.setTimeout(() => setDescription(""), 0);
      return () => window.clearTimeout(timer);
    }
  }, [open]);

  const trimmed = description.trim();
  const canSubmit = trimmed.length > 0 && !loading;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    await onSubmit(trimmed);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="graphql-ai-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            {t("graphql.aiDialog.title")}
          </DialogTitle>
          <DialogDescription>
            {t("graphql.aiDialog.description")}
            {!hasSchema && (
              <span className="block mt-1 text-warning">
                {t("graphql.aiDialog.noSchemaWarning")}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("graphql.aiDialog.placeholder")}
            className="min-h-28 text-sm"
            autoFocus
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                handleSubmit();
              }
            }}
            data-testid="graphql-ai-description"
            disabled={loading}
          />

          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setDescription(t(s))}
                disabled={loading}
                className={cn(
                  "text-[10px] px-2 py-1 rounded border border-border bg-background",
                  "hover:bg-accent/30 hover:text-foreground text-muted-foreground",
                  "transition-colors disabled:opacity-50",
                )}
                data-testid={`graphql-ai-suggestion-${s.slice(0, 20)}`}
              >
                {t(s)}
              </button>
            ))}
          </div>

          {error && (
            <div
              className="flex items-start gap-1 text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded p-2"
              data-testid="graphql-ai-error"
            >
              <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <p className="text-[10px] text-muted-foreground">{t("graphql.aiDialog.tip")}</p>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
            data-testid="graphql-ai-cancel"
          >
            {t("graphql.aiDialog.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit} data-testid="graphql-ai-submit">
            {loading ? (
              <>
                <Loader2 className="w-3 h-3 mr-1 animate-spin" /> {t("graphql.aiDialog.generating")}
              </>
            ) : (
              <>
                <Sparkles className="w-3 h-3 mr-1" /> {t("graphql.aiDialog.generate")}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

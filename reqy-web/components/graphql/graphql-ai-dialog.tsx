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

const SUGGESTIONS = [
  "Give me the first 5 countries with their code and capital",
  "Fetch the current user with their last 3 orders",
  "List all products under $50, sorted by price",
  "Get a user by ID with their posts and comments",
];

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
  const [description, setDescription] = useState("");

  // Reset on close.
  useEffect(() => {
    if (!open) setDescription("");
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
            Générer une query GraphQL
          </DialogTitle>
          <DialogDescription>
            Décris en français (ou anglais) les données que tu veux récupérer.
            {!hasSchema && (
              <span className="block mt-1 text-warning">
                Aucun schéma chargé — lance d&apos;abord Refresh Schema pour de meilleurs résultats.
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder='Ex: "Liste tous les pays avec leur code, capitale et continent"'
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
                onClick={() => setDescription(s)}
                disabled={loading}
                className={cn(
                  "text-[10px] px-2 py-1 rounded border border-border bg-background",
                  "hover:bg-accent/30 hover:text-foreground text-muted-foreground",
                  "transition-colors disabled:opacity-50",
                )}
                data-testid={`graphql-ai-suggestion-${s.slice(0, 20)}`}
              >
                {s}
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

          <p className="text-[10px] text-muted-foreground">
            Astuce : ⌘/Ctrl+Entrée pour générer. Configure ton provider dans Settings si ce
            n&apos;est pas déjà fait.
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
            data-testid="graphql-ai-cancel"
          >
            Annuler
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit} data-testid="graphql-ai-submit">
            {loading ? (
              <>
                <Loader2 className="w-3 h-3 mr-1 animate-spin" /> Génération…
              </>
            ) : (
              <>
                <Sparkles className="w-3 h-3 mr-1" /> Générer
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

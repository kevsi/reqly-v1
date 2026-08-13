"use client";

/**
 * Phase 7.3 — Thumbs up / down rating for diagnostics
 *
 * Persists the rating via feedback-store. Displays the current rating
 * if one exists. No-op visually while the request is in-flight.
 */
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { rateDiagnostic, getRating, type Rating } from "@/src/ai/cloud-engine/feedback-store";

export interface RatingButtonsProps {
  diagnosticId: string;
  className?: string;
}

export function RatingButtons({ diagnosticId, className }: RatingButtonsProps) {
  const { t } = useTranslation();
  const [override, setOverride] = useState<{ id: string; value: Rating | null } | null>(null);
  const rating = override?.id === diagnosticId ? override.value : getRating(diagnosticId);

  function handleClick(next: Rating) {
    // Toggle: clicking the same rating clears it.
    const target = rating === next ? null : next;
    rateDiagnostic(diagnosticId, target);
    setOverride({ id: diagnosticId, value: target });
  }

  return (
    <div
      className={cn("inline-flex items-center gap-1", className)}
      data-testid="rating-buttons"
      data-rating={rating ?? "none"}
    >
      <Button
        type="button"
        variant="ghost"
        onClick={() => handleClick("up")}
        aria-label={t("ai.rating.helpfulAria")}
        aria-pressed={rating === "up"}
        title={t("ai.rating.helpfulTitle")}
        className={cn(
          "size-6 rounded [&_svg]:size-3",
          rating === "up"
            ? "bg-success/20 text-success"
            : "text-muted-foreground/60 hover:bg-success/10 hover:text-success",
        )}
      >
        <ThumbsUp className="size-3" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        onClick={() => handleClick("down")}
        aria-label={t("ai.rating.unhelpfulAria")}
        aria-pressed={rating === "down"}
        title={t("ai.rating.unhelpfulTitle")}
        className={cn(
          "size-6 rounded [&_svg]:size-3",
          rating === "down"
            ? "bg-destructive/20 text-destructive"
            : "text-muted-foreground/60 hover:bg-destructive/10 hover:text-destructive",
        )}
      >
        <ThumbsDown className="size-3" />
      </Button>
    </div>
  );
}

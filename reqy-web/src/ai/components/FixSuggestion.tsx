import type { Diagnostic } from "@/src/ai/types";
import { DiagBadge } from "./DiagBadge";
import { RatingButtons } from "./RatingButtons";

export function FixSuggestion({
  diagnostic,
  onApply,
}: {
  diagnostic: Diagnostic;
  onApply?: () => void;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-3 space-y-2" data-testid={`fix-${diagnostic.id}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <DiagBadge severity={diagnostic.severity} />
          <span className="text-sm font-medium truncate">{diagnostic.title}</span>
        </div>
        <RatingButtons diagnosticId={diagnostic.id} />
      </div>
      <p className="text-xs text-muted-foreground">{diagnostic.explanation}</p>
      {diagnostic.fix && (
        <div className="flex items-center justify-between gap-2 pt-1">
          <p className="text-xs text-muted-foreground">{diagnostic.fix.description}</p>
          <button
            type="button"
            onClick={onApply}
            disabled={!onApply}
            data-testid={`apply-fix-${diagnostic.id}`}
            className="rounded-lg bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Appliquer le fix
          </button>
        </div>
      )}
    </div>
  );
}

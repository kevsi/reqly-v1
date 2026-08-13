"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, X, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

interface Props {
  /** Section title shown in the header (e.g. "Variables", "Headers", "Builder") */
  title: string;
  /** Optional count badge (e.g. number of variables / headers) */
  count?: number;
  /** Show a small red dot if true */
  error?: boolean;
  /** Whether the section body is initially visible (defaults to true) */
  defaultOpen?: boolean;
  /** Optional close handler — if provided, an X button is rendered */
  onClose?: () => void;
  /** Extra small description next to the title */
  hint?: string;
  /** Optional max-height class for the body content (defaults to 40vh) */
  bodyMaxHeightClass?: string;
  /** Extra class for the outer wrapper */
  className?: string;
  children: React.ReactNode;
}

/**
 * Collapsible section used by the GraphQL request panel to host Variables,
 * Headers, and the visual Builder without them pushing the editor out of
 * the viewport.
 *
 * - Header is always visible (title + count + optional close).
 * - Body is collapsible via the chevron; capped at 40vh by default with
 *   its own scroll so the editor below stays reachable.
 * - When onClose is provided, the X button completely hides the section.
 */
export function CollapsibleSection({
  title,
  count,
  error = false,
  defaultOpen = true,
  onClose,
  hint,
  bodyMaxHeightClass = "max-h-[40vh]",
  className,
  children,
}: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      className={cn("border-b bg-background", className)}
      data-testid={`collapsible-${title.toLowerCase()}`}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-muted/20">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1.5 text-xs font-medium text-foreground hover:text-foreground/80 shrink min-w-0"
          aria-expanded={open}
        >
          {open ? (
            <ChevronDown className="w-3.5 h-3.5 shrink-0" />
          ) : (
            <ChevronUp className="w-3.5 h-3.5 shrink-0" />
          )}
          <span className="truncate">{title}</span>
          {typeof count === "number" && count > 0 && (
            <span
              className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold bg-primary/15 text-primary shrink-0"
              data-testid={`collapsible-count-${title.toLowerCase()}`}
            >
              {count}
            </span>
          )}
          {error && (
            <AlertCircle
              className="w-3.5 h-3.5 text-destructive shrink-0"
              data-testid={`collapsible-error-${title.toLowerCase()}`}
              aria-label={t("graphql.collapsible.invalidInput")}
            />
          )}
          {hint && (
            <span className="text-[10px] text-muted-foreground truncate shrink-0">{hint}</span>
          )}
        </button>
        {onClose && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0 shrink-0"
            onClick={onClose}
            aria-label={t("graphql.collapsible.closeSection", { title })}
            data-testid={`collapsible-close-${title.toLowerCase()}`}
          >
            <X className="w-3 h-3" />
          </Button>
        )}
      </div>
      {open && <div className={cn("overflow-auto", bodyMaxHeightClass)}>{children}</div>}
    </div>
  );
}

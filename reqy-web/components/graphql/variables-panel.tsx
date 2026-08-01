"use client";

import { useState, useRef, useCallback } from "react";
import { ChevronDown, ChevronRight, AlertCircle, Braces } from "lucide-react";
import { JsonTextarea } from "@/components/json-textarea";
import { cn } from "@/lib/utils";

interface Props {
  value: string;
  onChange: (v: string) => void;
  defaultOpen?: boolean;
  /**
   * When true, skip rendering the panel's own header (the chevron + title)
   * so the section can be hosted inside a CollapsibleSection that already
   * provides a header.
   */
  hideHeader?: boolean;
  /** Extra className for the inner wrapper when hideHeader is true. */
  className?: string;
  /** Environment variable names to suggest for insertion. */
  environmentVariableNames?: string[];
}

export function VariablesPanel({
  value,
  onChange,
  defaultOpen = false,
  hideHeader = false,
  className,
  environmentVariableNames,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  let error: string | null = null;
  if (value.trim() && value.trim() !== "{}") {
    try {
      JSON.parse(value);
    } catch (e) {
      error = e instanceof Error ? e.message : "Invalid JSON";
    }
  }

  const handleInsertVariable = useCallback(
    (varName: string) => {
      if (!varName) return;
      const ta = textareaRef.current;
      if (!ta) {
        // Fallback: append at end
        onChange(value + `{{${varName}}}`);
        return;
      }
      const start = ta.selectionStart ?? value.length;
      const end = ta.selectionEnd ?? value.length;
      const insertion = `{{${varName}}}`;
      const next = value.slice(0, start) + insertion + value.slice(end);
      onChange(next);
      // Restore cursor position after the inserted text
      requestAnimationFrame(() => {
        const pos = start + insertion.length;
        ta.setSelectionRange(pos, pos);
        ta.focus();
      });
    },
    [value, onChange],
  );

  const envVars = environmentVariableNames?.filter(Boolean) ?? [];

  return (
    <div
      className={cn("border-b", hideHeader && "border-b-0", className)}
      data-testid="graphql-variables-panel"
    >
      {!hideHeader && (
        <button
          type="button"
          className="flex items-center gap-1 w-full p-2 text-xs font-medium hover:bg-accent/30"
          onClick={() => setOpen(!open)}
        >
          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          Variables
          {error && <AlertCircle className="w-3 h-3 text-destructive ml-1" />}
        </button>
      )}
      {open && (
        <div className={cn("p-2 space-y-1", hideHeader && "p-3")}>
          {/* Variable insertion toolbar */}
          {envVars.length > 0 && (
            <div className="flex items-center gap-1.5 pb-1">
              <Braces className="size-3 text-muted-foreground/50 shrink-0" />
              <select
                aria-label="Insert environment variable"
                className="h-7 rounded-md border border-input/50 bg-muted/30 px-1.5 text-[10px] font-mono text-muted-foreground cursor-pointer outline-none hover:border-muted-foreground/30 appearance-none flex-1"
                value=""
                onChange={(e) => {
                  handleInsertVariable(e.target.value);
                  e.target.value = "";
                }}
              >
                <option value="" disabled>
                  Insert variable...
                </option>
                {envVars.map((name) => (
                  <option key={name} value={name}>{`{{${name}}}`}</option>
                ))}
              </select>
            </div>
          )}
          <JsonTextarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder='{ "id": 1 }'
            className="text-xs min-h-24"
            data-testid="graphql-variables-textarea"
          />
          {error && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

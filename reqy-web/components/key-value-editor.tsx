"use client";

import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { AutocompleteInput, type AutocompleteGroup } from "@/components/ui/autocomplete-input";

export interface KeyValuePair {
  key: string;
  value: string;
  enabled?: boolean;
}

interface KeyValueEditorProps {
  pairs: KeyValuePair[];
  onChange: (pairs: KeyValuePair[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  addLabel?: string;
  emptyLabel?: string;
  showToggle?: boolean;
  /** Suggestions for the key input (grouped). */
  keySuggestions?: AutocompleteGroup[];
  /** Suggestions for the value input (grouped). */
  valueSuggestions?: AutocompleteGroup[];
}

export function KeyValueEditor({
  pairs,
  onChange,
  keyPlaceholder = "Key",
  valuePlaceholder = "Value",
  addLabel = "Add",
  emptyLabel = "No items added yet",
  showToggle = false,
  keySuggestions,
  valueSuggestions,
}: KeyValueEditorProps) {
  const add = () => onChange([...pairs, { key: "", value: "", enabled: true }]);

  const remove = (index: number) => {
    onChange(pairs.filter((_, i) => i !== index));
  };

  const update = (index: number, field: "key" | "value", value: string) => {
    onChange(pairs.map((pair, i) => (i === index ? { ...pair, [field]: value } : pair)));
  };

  const toggle = (index: number, enabled: boolean) => {
    onChange(pairs.map((pair, i) => (i === index ? { ...pair, enabled } : pair)));
  };

  return (
    <div>
      {pairs.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border/50 py-8 text-center">
          <div className="flex size-8 items-center justify-center rounded-full bg-muted/50">
            <Plus className="size-4 text-muted-foreground/40" />
          </div>
          <span className="text-xs font-medium text-muted-foreground/60">{emptyLabel}</span>
          <span className="text-[11px] text-muted-foreground/40">
            Click below to add your first entry
          </span>
        </div>
      ) : (
        <div className="space-y-2">
          {pairs.map((pair, index) => (
            <div
              key={index}
              className={cn(
                "group/row flex items-center gap-2 rounded-lg border border-transparent px-1 py-0.5 transition-all duration-200 hover:border-border/40 hover:bg-muted/30",
                showToggle && pair.enabled === false && "opacity-50",
              )}
            >
              {showToggle && (
                <Switch
                  checked={pair.enabled !== false}
                  onCheckedChange={(checked) => toggle(index, checked)}
                  aria-label={pair.enabled !== false ? "Disable" : "Enable"}
                  className="shrink-0"
                />
              )}
              <AutocompleteInput
                type="text"
                value={pair.key}
                onChange={(value) => update(index, "key", value)}
                placeholder={keyPlaceholder}
                className="flex-1 h-9 border-input bg-muted/20 text-sm transition-all duration-200 focus:bg-muted/40"
                suggestions={keySuggestions}
                emptyMessage=""
              />
              <span className="shrink-0 text-muted-foreground/30">=</span>
              <AutocompleteInput
                type="text"
                value={pair.value}
                onChange={(value) => update(index, "value", value)}
                placeholder={valuePlaceholder}
                className="flex-1 h-9 border-input bg-muted/20 text-sm transition-all duration-200 focus:bg-muted/40"
                suggestions={valueSuggestions}
                emptyMessage=""
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => remove(index)}
                className={cn(
                  "shrink-0 size-8 text-muted-foreground/50 hover:text-destructive",
                  "opacity-0 group-hover/row:opacity-100 transition-all duration-200",
                )}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <Button
        variant="outline"
        onClick={add}
        className="mt-3 w-full border-dashed border-muted-foreground/20 text-muted-foreground/70 hover:text-foreground hover:border-muted-foreground/40 transition-all duration-200 h-9 text-xs font-medium"
      >
        <Plus className="size-3.5 mr-1" />
        {addLabel}
      </Button>
    </div>
  );
}

"use client";

import { Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
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
  keyPlaceholder,
  valuePlaceholder,
  addLabel,
  emptyLabel,
  showToggle = false,
  keySuggestions,
  valueSuggestions,
}: KeyValueEditorProps) {
  const { t } = useTranslation();
  const resolvedKeyPlaceholder = keyPlaceholder ?? t("request.kvKey");
  const resolvedValuePlaceholder = valuePlaceholder ?? t("request.kvValue");
  const resolvedAddLabel = addLabel ?? t("common.add");
  const resolvedEmptyLabel = emptyLabel ?? t("request.noParams");
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
          <span className="text-xs font-medium text-muted-foreground/60">{resolvedEmptyLabel}</span>
          <span className="text-[11px] text-muted-foreground/40">{t("common.addEntryHint")}</span>
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
                  aria-label={pair.enabled !== false ? t("common.disable") : t("common.enable")}
                  className="shrink-0"
                />
              )}
              <AutocompleteInput
                type="text"
                value={pair.key}
                onChange={(value) => update(index, "key", value)}
                placeholder={resolvedKeyPlaceholder}
                aria-label={`${resolvedKeyPlaceholder} ${index + 1}`}
                className="flex-1 h-9 border-input bg-muted/20 text-sm transition-all duration-200 focus:bg-muted/40"
                suggestions={keySuggestions}
                emptyMessage=""
              />
              <span className="shrink-0 text-muted-foreground/30">=</span>
              <AutocompleteInput
                type="text"
                value={pair.value}
                onChange={(value) => update(index, "value", value)}
                placeholder={resolvedValuePlaceholder}
                aria-label={`${resolvedValuePlaceholder} ${index + 1}`}
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
                  "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 transition-all duration-200",
                )}
                aria-label={`${t("common.delete")} ${index + 1}`}
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
        {resolvedAddLabel}
      </Button>
    </div>
  );
}

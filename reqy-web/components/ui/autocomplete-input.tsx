"use client";

import { useState, useRef, useEffect, useCallback, useMemo, useId, forwardRef } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AutocompleteItem {
  id: string;
  /** Display label in the dropdown. */
  label: string;
  /** Value to insert into the input when selected. */
  value: string;
  /** Optional secondary description shown below the label. */
  description?: string;
}

export interface AutocompleteGroup {
  label: string;
  items: AutocompleteItem[];
}

export interface AutocompleteInputProps extends Omit<
  React.ComponentPropsWithoutRef<typeof Input>,
  "onChange" | "value"
> {
  value: string;
  onChange: (value: string) => void;
  /** Grouped suggestions. When empty or undefined, behaves as a normal Input. */
  suggestions?: AutocompleteGroup[];
  /** Max height of the dropdown before it scrolls. */
  dropdownMaxHeight?: number;
  /** Placeholder shown when the dropdown is empty after filtering. */
  emptyMessage?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Simple case-insensitive fuzzy match — checks if all chars of `query` appear
 *  in order in `text`. Avoids pulling in a fuzzy library. */
function fuzzyMatch(text: string, query: string): boolean {
  if (!query) return true;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < lower.length && qi < q.length; ti++) {
    if (lower[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

function flattenAndFilter(
  groups: AutocompleteGroup[],
  query: string,
): Array<{ group: AutocompleteGroup; item: AutocompleteItem }> {
  const result: Array<{ group: AutocompleteGroup; item: AutocompleteItem }> = [];

  // When user is typing inside {{...}}, extract what's after the last {{
  // e.g. "{{BASE_URL}}/posts/{{"  → activeQuery = ""  (show all variables)
  // e.g. "{{BASE_URL}}/posts/{{p" → activeQuery = "p"  (show matching variables)
  // e.g. "hello world"            → activeQuery = "hello world"
  const lastOpen = query.lastIndexOf("{{");
  let activeQuery: string;
  if (lastOpen >= 0) {
    const afterOpen = query.slice(lastOpen + 2);
    activeQuery = afterOpen;
  } else {
    activeQuery = query;
  }

  for (const group of groups) {
    for (const item of group.items) {
      // Skip if the item's value is already present in the input
      // But only if the cursor is NOT inside a new {{...}}
      // (when inside {{}}, the user wants to insert another variable)
      if (lastOpen < 0 && item.value && query.includes(item.value)) continue;

      // Match against the active portion of the query
      if (fuzzyMatch(item.label, activeQuery)) {
        result.push({ group, item });
      }
    }
  }
  return result;
}

// ── Component ─────────────────────────────────────────────────────────────────

export const AutocompleteInput = forwardRef<HTMLInputElement, AutocompleteInputProps>(
  function AutocompleteInput(
    {
      value,
      onChange,
      suggestions,
      dropdownMaxHeight = 260,
      emptyMessage = "Aucun résultat",
      className,
      onFocus,
      onBlur,
      onKeyDown,
      ...inputProps
    },
    forwardedRef,
  ) {
    const internalRef = useRef<HTMLInputElement>(null);
    const inputRef = (forwardedRef ?? internalRef) as React.RefObject<HTMLInputElement | null>;
    const containerRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const [isOpen, setIsOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const [focused, setFocused] = useState(false);
    const id = useId();

    // Flatten + filter
    const flatList = useMemo(
      () => flattenAndFilter(suggestions ?? [], value),
      [suggestions, value],
    );

    // Build a map of group → indices for rendering
    const groupedFiltered = useMemo(() => {
      const map = new Map<string, AutocompleteItem[]>();
      for (const entry of flatList) {
        const arr = map.get(entry.group.label) ?? [];
        arr.push(entry.item);
        map.set(entry.group.label, arr);
      }
      return map;
    }, [flatList]);

    const totalItems = flatList.length;

    // Reset active index when list changes
    useEffect(() => {
      setActiveIndex(-1);
    }, [flatList.length]);

    // Show dropdown when focused and there are suggestions
    const show = focused && isOpen && (suggestions?.length ?? 0) > 0;

    // ── Scroll active item into view ──────────────────────────────────────────
    useEffect(() => {
      if (activeIndex < 0 || !listRef.current) return;
      const items = listRef.current.querySelectorAll<HTMLElement>("[data-autocomplete-item]");
      const el = items[activeIndex];
      el?.scrollIntoView({ block: "nearest" });
    }, [activeIndex]);

    // ── Click outside handler ─────────────────────────────────────────────────
    useEffect(() => {
      if (!show) return;
      function handleClick(e: MouseEvent) {
        if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
          setIsOpen(false);
        }
      }
      // Delay to avoid the same click that opened the input
      const timer = window.setTimeout(() => document.addEventListener("mousedown", handleClick), 0);
      return () => {
        clearTimeout(timer);
        document.removeEventListener("mousedown", handleClick);
      };
    }, [show]);

    // ── Keyboard navigation ───────────────────────────────────────────────────
    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLInputElement>) => {
        onKeyDown?.(e);

        if (!show) {
          if (e.key === "ArrowDown" && totalItems > 0) {
            e.preventDefault();
            setIsOpen(true);
            setActiveIndex(0);
          }
          return;
        }

        switch (e.key) {
          case "ArrowDown":
            e.preventDefault();
            setActiveIndex((prev) => (prev < totalItems - 1 ? prev + 1 : 0));
            break;
          case "ArrowUp":
            e.preventDefault();
            setActiveIndex((prev) => (prev > 0 ? prev - 1 : totalItems - 1));
            break;
          case "Enter":
            e.preventDefault();
            if (activeIndex >= 0 && activeIndex < flatList.length) {
              selectItem(flatList[activeIndex].item);
            }
            break;
          case "Escape":
            e.preventDefault();
            setIsOpen(false);
            break;
        }
      },
      [show, totalItems, activeIndex, flatList, onKeyDown],
    );

    // ── Select an item ────────────────────────────────────────────────────────
    const selectItem = useCallback(
      (item: AutocompleteItem) => {
        // If the user is inside a {{...}} block, insert only at that position
        // instead of replacing the entire input value.
        const lastOpen = value.lastIndexOf("{{");
        if (lastOpen >= 0) {
          const before = value.slice(0, lastOpen);
          onChange(before + item.value);
        } else {
          onChange(item.value);
        }
        setIsOpen(false);
        setActiveIndex(-1);
        inputRef.current?.focus();
      },
      [onChange, value],
    );

    // ── Handlers ──────────────────────────────────────────────────────────────
    const handleFocus = useCallback(
      (e: React.FocusEvent<HTMLInputElement>) => {
        onFocus?.(e);
        setFocused(true);
        if (totalItems > 0) setIsOpen(true);
      },
      [onFocus, totalItems],
    );

    const handleBlur = useCallback(
      (e: React.FocusEvent<HTMLInputElement>) => {
        onBlur?.(e);
        // Delay to let click on dropdown items register
        window.setTimeout(() => {
          if (!containerRef.current?.contains(document.activeElement)) {
            setFocused(false);
            setIsOpen(false);
          }
        }, 150);
      },
      [onBlur],
    );

    const handleInputChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        onChange(e.target.value);
        if (!isOpen && totalItems > 0) setIsOpen(true);
      },
      [onChange, isOpen, totalItems],
    );

    return (
      <div ref={containerRef} className="relative">
        <Input
          ref={inputRef}
          value={value}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className={className}
          {...inputProps}
        />

        {/* Dropdown */}
        {show && (
          <div
            ref={listRef}
            role="listbox"
            aria-label="Suggestions"
            className={cn(
              "absolute left-0 right-0 z-50 mt-1 overflow-auto rounded-lg border border-border bg-popover shadow-lg animate-in fade-in-0 zoom-in-95",
            )}
            style={{ maxHeight: dropdownMaxHeight }}
          >
            {totalItems === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground/60">{emptyMessage}</div>
            ) : (
              Array.from(groupedFiltered.entries()).map(([groupLabel, items], gi) => (
                <div key={groupLabel}>
                  {gi > 0 && <div className="mx-3 border-t border-border/40" />}
                  <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50">
                    {groupLabel}
                  </div>
                  {items.map((item) => {
                    const idx = flatList.findIndex(
                      (f) => f.item.id === item.id && f.group.label === groupLabel,
                    );
                    const isActive = idx === activeIndex;
                    return (
                      <div
                        key={item.id}
                        data-autocomplete-item
                        role="option"
                        aria-selected={isActive}
                        className={cn(
                          "flex cursor-pointer items-center gap-2 px-3 py-2 text-xs transition-colors",
                          isActive
                            ? "bg-accent text-accent-foreground"
                            : "text-popover-foreground hover:bg-accent/50",
                        )}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          selectItem(item);
                        }}
                        onMouseEnter={() => setActiveIndex(idx)}
                      >
                        <span className="truncate flex-1">{item.label}</span>
                        {item.description && (
                          <span className="shrink-0 text-[10px] text-muted-foreground/50">
                            {item.description}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    );
  },
);

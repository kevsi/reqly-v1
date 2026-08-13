"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RotateCcw, RotateCcwIcon, Pencil, Check, X } from "lucide-react";
import { useShortcuts } from "@/hooks/use-shortcuts";
import { SHORTCUT_DEFS, type KeyCombo } from "@/lib/shortcut-defs";
import { useTranslation } from "react-i18next";

export function KeyboardSection() {
  const { custom, getKeys, setCustom, reset, resetAll } = useShortcuts();
  const { t } = useTranslation();
  const [editingId, setEditingId] = useState<string | null>(null);

  // Group by category
  const byCategory = new Map<string, typeof SHORTCUT_DEFS>();
  for (const def of SHORTCUT_DEFS) {
    const list = byCategory.get(def.categoryKey) ?? [];
    list.push(def);
    byCategory.set(def.categoryKey, list);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">{t("settings.keyboard.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("settings.keyboard.description")}</p>
        </div>
        {Object.keys(custom).length > 0 && (
          <Button variant="ghost" size="sm" onClick={resetAll} className="gap-2">
            <RotateCcw className="size-3.5" />
            {t("settings.keyboard.resetAll")}
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="space-y-8 pt-6">
          {Array.from(byCategory.entries()).map(([category, defs]) => (
            <div key={category}>
              <h3 className="mb-3 text-sm font-medium text-muted-foreground uppercase tracking-wider">
                {t(category)}
              </h3>
              <div className="space-y-2">
                {defs.map((def) => {
                  const isCustom = custom[def.id] !== undefined;
                  const isEditing = editingId === def.id;
                  return (
                    <div
                      key={def.id}
                      className="group flex items-center justify-between rounded-lg border border-border/50 bg-muted/20 px-4 py-2.5"
                    >
                      <span className="text-sm">{t(def.descriptionKey)}</span>
                      <div className="flex items-center gap-2">
                        {isEditing ? (
                          <KeyRecorder
                            initialKeys={getKeys(def.id)}
                            onSave={(combo) => {
                              setCustom(def.id, combo);
                              setEditingId(null);
                            }}
                            onCancel={() => setEditingId(null)}
                          />
                        ) : (
                          <div className="flex items-center gap-1">
                            <ComboBadge combo={getKeys(def.id)} isCustom={isCustom} />
                            <button
                              type="button"
                              onClick={() => setEditingId(def.id)}
                              className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity"
                              aria-label={t("settings.keyboard.editShortcut")}
                            >
                              <Pencil className="size-3.5 text-muted-foreground hover:text-foreground" />
                            </button>
                            {isCustom && (
                              <button
                                type="button"
                                onClick={() => reset(def.id)}
                                className="opacity-0 group-hover:opacity-100 transition-opacity"
                                aria-label={t("settings.keyboard.resetShortcut")}
                              >
                                <RotateCcwIcon className="size-3.5 text-muted-foreground hover:text-foreground" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Combo badge ────────────────────────────────────────────────────
function ComboBadge({ combo, isCustom }: { combo: KeyCombo; isCustom: boolean }) {
  const parts: string[] = [];
  if (combo.ctrl) parts.push("Ctrl");
  if (combo.shift) parts.push("⇧");
  if (combo.alt) parts.push("Alt");
  parts.push(combo.key.charAt(0).toUpperCase() + combo.key.slice(1));

  return parts.map((p, i) => (
    <span key={i}>
      <Badge
        variant="outline"
        className={cn(
          "font-mono text-xs tracking-wide tabular-nums",
          isCustom ? "border-primary/50 text-primary" : "",
        )}
      >
        {p}
      </Badge>
      {i < parts.length - 1 && <span className="mx-0.5 text-xs text-muted-foreground">+</span>}
    </span>
  ));
}

// ─── Key recorder ───────────────────────────────────────────────────
function keyLabel(e: KeyboardEvent): string | null {
  if (e.key === "Control" || e.key === "Meta" || e.key === "Shift" || e.key === "Alt") return null;
  if (e.key === " ") return "Space";
  if (e.key.length === 1) return e.key.toUpperCase();
  return e.key;
}

function KeyRecorder({
  initialKeys,
  onSave,
  onCancel,
}: {
  initialKeys: KeyCombo;
  onSave: (combo: KeyCombo) => void;
  onCancel: () => void;
}) {
  const [recording, setRecording] = useState(false);
  const [current, setCurrent] = useState<KeyCombo>(initialKeys);
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        onCancel();
        return;
      }
      if (e.key === "Enter") {
        // Only save if there's at least one modifier + a key
        if (current.key && (current.ctrl || current.shift || current.alt)) {
          onSave(current);
        }
        return;
      }

      const label = keyLabel(e);
      if (label) {
        setCurrent((prev) => ({
          ...prev,
          key: label,
          ctrl: prev.ctrl || e.ctrlKey || e.metaKey,
          shift: prev.shift || e.shiftKey,
          alt: prev.alt || e.altKey,
        }));
      } else {
        // Modifier key pressed alone — track it
        setCurrent((prev) => ({
          ...prev,
          ctrl: prev.ctrl || e.ctrlKey || e.metaKey,
          shift: prev.shift || e.shiftKey,
          alt: prev.alt || e.altKey,
        }));
      }
    },
    [current, onSave, onCancel],
  );

  useEffect(() => {
    if (recording) {
      window.addEventListener("keydown", handleKey, true);
      return () => window.removeEventListener("keydown", handleKey, true);
    }
  }, [recording, handleKey]);

  // Auto-start recording on mount
  useEffect(() => {
    setRecording(true);
  }, []);

  const parts: string[] = [];
  if (current.ctrl) parts.push("Ctrl");
  if (current.shift) parts.push("⇧");
  if (current.alt) parts.push("Alt");
  if (current.key) parts.push(current.key);

  return (
    <div ref={ref} className="flex items-center gap-1.5">
      <div
        className={cn(
          "flex items-center gap-0.5 rounded-md border px-2 py-0.5 font-mono text-xs",
          recording ? "border-primary animate-pulse" : "border-border",
        )}
        onClick={() => setRecording(true)}
      >
        {parts.length > 0 ? (
          parts.map((p, i) => (
            <span key={i}>
              <Badge variant="secondary" className="font-mono text-xs">
                {p}
              </Badge>
              {i < parts.length - 1 && <span className="mx-0.5 text-muted-foreground">+</span>}
            </span>
          ))
        ) : (
          <span className="text-muted-foreground text-xs px-1">
            {t("settings.keyboard.pressKey")}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={() => {
          if (current.key && (current.ctrl || current.shift || current.alt)) {
            onSave(current);
          }
        }}
        className="text-green-600 hover:text-green-500 dark:text-green-400 dark:hover:text-green-300"
        aria-label={t("common.confirm")}
      >
        <Check className="size-4" />
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="text-muted-foreground hover:text-foreground"
        aria-label={t("common.cancel")}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

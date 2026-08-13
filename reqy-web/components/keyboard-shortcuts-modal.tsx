"use client";

import { useState, useEffect } from "react";
import { X, Keyboard } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SHORTCUT_DEFS, type ShortcutDef } from "@/lib/shortcut-defs";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

interface KeyboardShortcutsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function KeyboardShortcutsModal({ open, onOpenChange }: KeyboardShortcutsModalProps) {
  const [isMac, setIsMac] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    setIsMac(navigator.platform.toUpperCase().indexOf("MAC") >= 0);
  }, []);

  // Grouper les raccourcis par catégorie
  const categories = SHORTCUT_DEFS.reduce(
    (acc, shortcut) => {
      if (!acc[shortcut.categoryKey]) {
        acc[shortcut.categoryKey] = [];
      }
      acc[shortcut.categoryKey].push(shortcut);
      return acc;
    },
    {} as Record<string, ShortcutDef[]>,
  );

  const formatKey = (key: string, ctrl?: boolean, shift?: boolean, alt?: boolean) => {
    const parts: string[] = [];

    if (ctrl) {
      parts.push(isMac ? "⌘" : "Ctrl");
    }
    if (shift) {
      parts.push(isMac ? "⇧" : "Shift");
    }
    if (alt) {
      parts.push(isMac ? "⌥" : "Alt");
    }

    // Format special keys
    const formattedKey = key === "Enter" ? "↵" : key.charAt(0).toUpperCase() + key.slice(1);
    parts.push(formattedKey);

    return parts;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Keyboard className="size-5 text-primary" />
            <DialogTitle>{t("settings.keyboard.title")}</DialogTitle>
          </div>
        </DialogHeader>

        <div className="overflow-y-auto flex-1 -mx-6 px-6 space-y-6">
          {Object.entries(categories).map(([category, shortcuts]) => (
            <div key={category}>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                {t(category)}
              </h3>
              <div className="space-y-2">
                {shortcuts.map((shortcut) => {
                  const keyParts = formatKey(
                    shortcut.defaultKeys.key,
                    shortcut.defaultKeys.ctrl,
                    shortcut.defaultKeys.shift,
                    shortcut.defaultKeys.alt,
                  );

                  return (
                    <div
                      key={shortcut.id}
                      className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <span className="text-sm text-foreground">{t(shortcut.descriptionKey)}</span>
                      <div className="flex items-center gap-1">
                        {keyParts.map((part, idx) => (
                          <kbd
                            key={idx}
                            className={cn(
                              "inline-flex items-center justify-center",
                              "min-w-[1.75rem] h-7 px-2",
                              "rounded border border-border bg-muted",
                              "font-mono text-xs font-medium text-muted-foreground",
                              "shadow-sm",
                            )}
                          >
                            {part}
                          </kbd>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between pt-4 border-t text-xs text-muted-foreground">
          <p>{t("settings.keyboard.closeHint", { key: isMac ? "⌘" : "Ctrl" })}</p>
          <button
            onClick={() => onOpenChange(false)}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

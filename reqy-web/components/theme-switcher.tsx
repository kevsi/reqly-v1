"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Palette, Check } from "lucide-react";
import { useTheme, type Theme } from "./theme-provider";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const themes: {
  value: Theme;
  label: string;
  description: string;
  bg: string;
  card: string;
  accent: string;
}[] = [
  {
    value: "light",
    label: "Light",
    description: "Clean white interface",
    bg: "#f5f5f5",
    card: "#ffffff",
    accent: "#10b981",
  },
  {
    value: "dark",
    label: "Dark",
    description: "Easy on the eyes",
    bg: "#1a1a1a",
    card: "#262626",
    accent: "#10b981",
  },
  {
    value: "emerald",
    label: "Emerald",
    description: "Fresh green tones",
    bg: "#ecfdf5",
    card: "#f0fdf8",
    accent: "#059669",
  },
  {
    value: "ocean",
    label: "Ocean",
    description: "Cool blue palette",
    bg: "#eff6ff",
    card: "#f0f7ff",
    accent: "#2563eb",
  },
  {
    value: "sunset",
    label: "Sunset",
    description: "Warm orange hues",
    bg: "#fff7ed",
    card: "#fffbf5",
    accent: "#ea580c",
  },
  {
    value: "purple",
    label: "Purple",
    description: "Rich violet tones",
    bg: "#faf5ff",
    card: "#fbf5ff",
    accent: "#9333ea",
  },
  {
    value: "midnight",
    label: "Midnight",
    description: "Deep dark mode",
    bg: "#050505",
    card: "#0e0e0e",
    accent: "#5b50db",
  },
];

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);

  const activeTheme = themes.find((t) => t.value === theme);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        title="Change theme"
      >
        <Palette className="size-4" />
        <span className="hidden sm:inline">Theme</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden">
          <DialogHeader className="border-b px-6 py-4">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Palette className="size-4 text-primary" />
              Appearance
            </DialogTitle>
          </DialogHeader>

          <div className="p-6 space-y-5">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Select a theme
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {themes.map((t) => {
                  const isActive = theme === t.value;
                  return (
                    <button
                      key={t.value}
                      onClick={() => {
                        setTheme(t.value);
                        setOpen(false);
                      }}
                      className={cn(
                        "group relative flex flex-col gap-3 rounded-xl border-2 p-3 text-left transition-all duration-150 hover:scale-[1.02]",
                        isActive
                          ? "border-primary ring-2 ring-primary/20"
                          : "border-border hover:border-muted-foreground/30",
                      )}
                    >
                      {/* Mini preview */}
                      <div
                        className="h-16 w-full rounded-lg overflow-hidden relative"
                        style={{ backgroundColor: t.bg }}
                      >
                        {/* Fake card */}
                        <div
                          className="absolute top-2 left-2 right-2 h-8 rounded-md"
                          style={{ backgroundColor: t.card, border: "1px solid rgba(0,0,0,0.07)" }}
                        />
                        {/* Fake accent bar */}
                        <div
                          className="absolute bottom-2 left-2 h-2 w-10 rounded-full"
                          style={{ backgroundColor: t.accent }}
                        />
                        {/* Fake lines */}
                        <div
                          className="absolute top-4 left-4 h-1.5 w-12 rounded-full opacity-30"
                          style={{ backgroundColor: t.accent }}
                        />
                        <div
                          className="absolute top-7 left-4 h-1 w-8 rounded-full opacity-20"
                          style={{ backgroundColor: t.accent }}
                        />
                      </div>

                      {/* Label + check */}
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold text-foreground leading-none">
                            {t.label}
                          </p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {t.description}
                          </p>
                        </div>
                        {isActive && (
                          <div className="flex size-5 items-center justify-center rounded-full bg-primary">
                            <Check className="size-3 text-primary-foreground" />
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Current theme info */}
            <div className="rounded-lg border bg-muted/40 px-4 py-3 flex items-center gap-3">
              <div
                className="size-5 rounded-full border border-border shrink-0"
                style={{ backgroundColor: activeTheme?.accent }}
              />
              <p className="text-xs text-muted-foreground">
                Active theme:{" "}
                <span className="font-semibold text-foreground">{activeTheme?.label}</span>
                {" — "}
                {activeTheme?.description}
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

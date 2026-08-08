"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Monitor, Palette, Check } from "lucide-react";
import { useTheme, type Theme, THEME_STORAGE_KEY, THEME_CHANGE_EVENT } from "./theme-provider";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type ThemeOption = Theme | "system";

const themes: {
  value: ThemeOption;
  label: string;
  description: string;
  bg: string;
  card: string;
  accent: string;
}[] = [
  {
    value: "system",
    label: "System",
    description: "Follows your OS",
    bg: "#f5f5f5",
    card: "#ffffff",
    accent: "#10b981",
  },
  {
    value: "light",
    label: "Light",
    description: "Clean white",
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

function clearStoredTheme() {
  try {
    window.localStorage.removeItem(THEME_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT));
}

function isSystemThemeActive(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === null;
  } catch {
    return false;
  }
}

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [systemActive, setSystemActive] = useState(isSystemThemeActive);

  const effectiveOption: ThemeOption = systemActive ? "system" : theme;
  const activeTheme = themes.find((t) => t.value === effectiveOption);

  function handleSelect(value: ThemeOption) {
    if (value === "system") {
      clearStoredTheme();
      setSystemActive(true);
    } else {
      setTheme(value);
      setSystemActive(false);
    }
    setOpen(false);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        title="Change theme"
      >
        {effectiveOption === "system" ? (
          <Monitor className="size-4" />
        ) : (
          <Palette className="size-4" />
        )}
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
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {themes.map((t) => {
                  const isActive = effectiveOption === t.value;
                  return (
                    <button
                      key={t.value}
                      onClick={() => handleSelect(t.value)}
                      className={cn(
                        "group relative flex flex-col gap-2.5 rounded-xl border-2 p-2.5 text-left transition-all duration-150 hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        isActive
                          ? "border-primary ring-2 ring-primary/20"
                          : "border-border hover:border-muted-foreground/30",
                      )}
                    >
                      {t.value === "system" ? (
                        <div className="h-14 w-full rounded-lg overflow-hidden relative flex">
                          <div className="flex-1 bg-[#f5f5f5] relative">
                            <div className="absolute top-1.5 left-1.5 right-0.5 h-5 rounded bg-white border border-black/6" />
                            <div
                              className="absolute bottom-1.5 left-1.5 h-1.5 w-6 rounded-full"
                              style={{ backgroundColor: t.accent }}
                            />
                          </div>
                          <div className="flex-1 bg-[#1a1a1a] relative">
                            <div className="absolute top-1.5 left-0.5 right-1.5 h-5 rounded bg-[#262626]" />
                            <div
                              className="absolute bottom-1.5 right-1.5 h-1.5 w-6 rounded-full"
                              style={{ backgroundColor: t.accent }}
                            />
                          </div>
                          <div className="absolute inset-y-0 left-1/2 w-px bg-white/20" />
                          <Monitor
                            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 size-4 drop-shadow"
                            style={{ color: t.accent }}
                          />
                        </div>
                      ) : (
                        <div
                          className="h-14 w-full rounded-lg overflow-hidden relative"
                          style={{ backgroundColor: t.bg }}
                        >
                          <div
                            className="absolute top-2 left-2 right-2 h-7 rounded-md"
                            style={{
                              backgroundColor: t.card,
                              border: "1px solid rgba(0,0,0,0.07)",
                            }}
                          />
                          <div
                            className="absolute top-3.5 left-3.5 h-2 w-5 rounded-full opacity-80"
                            style={{ backgroundColor: t.accent }}
                          />
                          <div
                            className="absolute top-3.5 left-10 right-3.5 h-2 rounded-full opacity-15"
                            style={{ backgroundColor: t.accent }}
                          />
                          <div
                            className="absolute bottom-2 left-2 h-1.5 w-10 rounded-full opacity-70"
                            style={{ backgroundColor: t.accent }}
                          />
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-semibold text-foreground leading-none">
                            {t.label}
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                            {t.description}
                          </p>
                        </div>
                        {isActive && (
                          <div className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary">
                            <Check className="size-2.5 text-primary-foreground" />
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="rounded-lg border bg-muted/40 px-4 py-3 flex items-center gap-3">
              <div
                className="size-5 rounded-full border border-border shrink-0 flex items-center justify-center overflow-hidden"
                style={effectiveOption !== "system" ? { backgroundColor: activeTheme?.accent } : {}}
              >
                {effectiveOption === "system" && (
                  <Monitor className="size-3 text-muted-foreground" />
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Active: <span className="font-semibold text-foreground">{activeTheme?.label}</span>
                {" — "}
                {activeTheme?.description}
                {effectiveOption === "system" && (
                  <span className="ml-1 text-muted-foreground/60">
                    (resolved to <span className="font-medium">{theme}</span>)
                  </span>
                )}
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

"use client";

import { cn } from "@/lib/utils";
import { useTheme, type Theme } from "@/components/theme-provider";
import { Check } from "lucide-react";

interface ThemeOption {
  id: Theme;
  label: string;
  preview: "light" | "dark";
}

const PRIMARY_THEMES: ThemeOption[] = [
  { id: "light", label: "Clair", preview: "light" },
  { id: "dark", label: "Sombre", preview: "dark" },
];

const MORE_THEMES: ThemeOption[] = [
  { id: "emerald", label: "Émeraude", preview: "light" },
  { id: "ocean", label: "Océan", preview: "light" },
  { id: "sunset", label: "Coucher de soleil", preview: "light" },
  { id: "purple", label: "Violet", preview: "light" },
  { id: "midnight", label: "Minuit", preview: "dark" },
];

function ThemePreview({ variant }: { variant: "light" | "dark" }) {
  const bg = variant === "light" ? "#ffffff" : "#0a0a0a";
  const surface = variant === "light" ? "#f4f4f5" : "#18181b";
  const accent = variant === "light" ? "#8B5CF6" : "#a78bfa";
  const text = variant === "light" ? "#18181b" : "#fafafa";
  return (
    <svg viewBox="0 0 120 80" className="h-20 w-full rounded-md border" aria-hidden="true">
      <rect width="120" height="80" fill={bg} />
      <rect x="8" y="8" width="24" height="64" rx="4" fill={surface} />
      <rect x="40" y="12" width="72" height="14" rx="3" fill={surface} />
      <rect x="40" y="32" width="48" height="14" rx="3" fill={surface} />
      <rect x="40" y="52" width="64" height="14" rx="3" fill={accent} opacity="0.2" />
      <rect x="44" y="56" width="20" height="6" rx="2" fill={accent} />
      <text x="12" y="22" fontSize="6" fill={text} fontWeight="600">
        Reqly
      </text>
    </svg>
  );
}

function ThemeCard({
  option,
  active,
  onSelect,
}: {
  option: ThemeOption;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        "group relative flex flex-col gap-3 rounded-xl border-2 p-3 text-left transition-all duration-150 hover:border-primary/40",
        active ? "border-primary shadow-sm scale-[1.02]" : "border-border",
      )}
    >
      {active && (
        <span className="absolute right-2 top-2 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="size-3" />
        </span>
      )}
      <ThemePreview variant={option.preview} />
      <span className="text-sm font-medium">{option.label}</span>
    </button>
  );
}

export function ThemeCards() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-medium">Thème</h3>
        <p className="text-xs text-muted-foreground">Choisissez l'apparence de l'interface.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {PRIMARY_THEMES.map((opt) => (
          <ThemeCard
            key={opt.id}
            option={opt}
            active={theme === opt.id}
            onSelect={() => setTheme(opt.id)}
          />
        ))}
      </div>
      <div>
        <p className="mb-2 text-xs text-muted-foreground">Plus de thèmes :</p>
        <div className="flex flex-wrap gap-2">
          {MORE_THEMES.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setTheme(opt.id)}
              aria-pressed={theme === opt.id}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors",
                theme === opt.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border hover:bg-muted",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

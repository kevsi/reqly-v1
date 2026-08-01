"use client";

import { useState, type FormEvent } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAccent, HEX_REGEX } from "@/hooks/use-accent";

export function AccentPicker() {
  const { accent, setAccent, presets } = useAccent();
  const [input, setInput] = useState(accent ?? "#");
  const [error, setError] = useState<string | null>(null);

  function applyCustom(e: FormEvent) {
    e.preventDefault();
    if (!HEX_REGEX.test(input)) {
      setError("Format hex invalide (ex: #8B5CF6)");
      return;
    }
    setError(null);
    setAccent(input);
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-medium">Couleur d'accent</h3>
        <p className="text-xs text-muted-foreground">
          Personnalisez la couleur primaire de l'interface.
        </p>
      </div>
      <div className="flex items-center gap-2">
        {presets.map((p) => {
          const active = accent?.toLowerCase() === p.hex.toLowerCase();
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setAccent(p.hex);
                setError(null);
              }}
              aria-label={p.label}
              aria-pressed={active}
              title={p.label}
              className={cn(
                "size-8 rounded-full border-2 transition-all hover:scale-110",
                active ? "border-foreground scale-110 shadow-sm" : "border-transparent",
              )}
              style={{ backgroundColor: p.hex }}
            />
          );
        })}
      </div>
      <form onSubmit={applyCustom} className="flex items-center gap-2">
        <div className="flex items-center gap-2 rounded-md border px-2 py-1">
          <span
            className="size-5 rounded border"
            style={{ backgroundColor: HEX_REGEX.test(input) ? input : "transparent" }}
            aria-hidden="true"
          />
          <Input
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setError(null);
            }}
            placeholder="#8B5CF6"
            className="h-7 w-28 border-0 p-0 font-mono text-xs"
            maxLength={7}
          />
        </div>
        <Button type="submit" size="sm" variant="outline">
          Appliquer
        </Button>
        {accent && (
          <Button type="button" size="sm" variant="ghost" onClick={() => setAccent(null)}>
            Réinitialiser
          </Button>
        )}
      </form>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

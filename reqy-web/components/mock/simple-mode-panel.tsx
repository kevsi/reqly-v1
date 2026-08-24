"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Sparkles, Wand2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import type { MockConfig } from "@reqly/mock-engine";
import { methodBadgeClass } from "./mock-utils";
import {
  MockGenerateConfigError,
  generateMockConfig,
} from "./mock-generate";

const K = {
  title: "mocks.simple.title",
  subtitle: "mocks.simple.subtitle",
  placeholder: "mocks.simple.placeholder",
  generate: "mocks.simple.generate",
  generating: "mocks.simple.generating",
  regenerate: "mocks.simple.regenerate",
  applyDraft: "mocks.simple.applyDraft",
  appliedTitle: "mocks.simple.appliedToast",
  example1: "mocks.simple.example1",
  example2: "mocks.simple.example2",
  example3: "mocks.simple.example3",
} as const;

const EXAMPLES = [
  {
    key: K.example1,
    fallback:
      "API users : GET /api/users (liste paginée), GET /api/users/:id (200 + 404 si id inconnu), POST /api/users (201), PUT /api/users/:id, DELETE /api/users/:id. Port 4015.",
  },
  {
    key: K.example2,
    fallback:
      "API e-commerce : produits (/api/products, /api/products/:id avec prix et stock), panier POST /api/cart, commande POST /api/orders qui renvoie 201 puis 402 si total > 1000.",
  },
  {
    key: K.example3,
    fallback:
      "Mock instable pour tester la résilience : GET /api/status en 200 mais avec 30 % de pannes timeout et une latence entre 200 et 800 ms.",
  },
] as const;

interface SimpleModePanelProps {
  /** Applique la config générée au brouillon (passe par le dialog de remplacement existant). */
  onRequestReplace: (
    next: MockConfig,
    successTitle?: { key: string; fallback: string } | null,
  ) => void;
  /** Notifié après chaque génération réussie (ajout à la librairie de configs). */
  onGenerated?: (config: MockConfig) => void;
  className?: string;
}

/** Vue « mode simple » : le dev décrit son mock, l'IA produit une config valide. */
export function SimpleModePanel({
  onRequestReplace,
  onGenerated,
  className,
}: SimpleModePanelProps) {
  const { t } = useTranslation();
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MockConfig | null>(null);
  const [resultSummary, setResultSummary] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function run() {
    if (!description.trim() || loading) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const out = await generateMockConfig(description, controller.signal);
      setResult(out.config);
      setResultSummary(out.summary);
      onGenerated?.(out.config);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(
        err instanceof MockGenerateConfigError
          ? err.message
          : "Génération impossible : vérifie ta configuration IA dans Réglages.",
      );
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  function applyGenerated() {
    if (!result) return;
    onRequestReplace(result, { key: K.appliedTitle, fallback: "Config IA appliquée au brouillon" });
  }

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col items-center overflow-y-auto p-1 scrollbar-discreet",
        className,
      )}
    >
      <div className="w-full max-w-2xl flex flex-col gap-4">
        <div className="text-center">
          <h2 className="text-foreground flex items-center justify-center gap-2 text-lg font-semibold">
            <Wand2 aria-hidden="true" className="text-primary size-5" />
            {t(K.title, { defaultValue: "Créer un mock avec l'IA" })}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {t(K.subtitle, {
              defaultValue:
                "Décris ton API en une phrase : routes, réponses, erreurs. La config est validée par le moteur avant application.",
            })}
          </p>
        </div>

        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void run();
          }}
          rows={5}
          placeholder={t(K.placeholder, {
            defaultValue:
              "Ex. : API de tâches avec GET /api/todos, POST /api/todos (201), DELETE /api/todos/:id (204) et 404 sur les ids inconnus.",
          })}
          aria-label={t(K.title, { defaultValue: "Créer un mock avec l'IA" })}
          className="min-h-28 font-mono text-xs"
        />

        <div className="flex flex-wrap gap-1">
          {EXAMPLES.map((ex) => (
            <button
              key={ex.key}
              type="button"
              onClick={() => setDescription(t(ex.key, { defaultValue: ex.fallback }))}
              className="border-border bg-accent/30 text-muted-foreground hover:border-primary/40 hover:text-foreground rounded-full border px-2 py-0.5 text-[11px] transition-colors"
            >
              {t(ex.key, { defaultValue: ex.fallback }).split(":")[0]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            onClick={() => void run()}
            disabled={loading || !description.trim()}
          >
            {loading ? (
              <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
            ) : (
              <Sparkles aria-hidden="true" className="size-3.5" />
            )}
            {loading
              ? t(K.generating, { defaultValue: "Génération…" })
              : t(K.generate, { defaultValue: "Générer la config" })}
          </Button>
          {!loading && result && (
            <span className="text-muted-foreground text-xs">{resultSummary}</span>
          )}
        </div>

        {error && (
          <p role="alert" className="text-destructive text-xs">
            {error}
          </p>
        )}

        {result && !loading && (
          <div className="bg-card rounded-xl border p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">
                {result.name || t(K.title, { defaultValue: "Mock généré" })}
                <Badge variant="secondary" className="ml-2 font-mono text-[10px]">
                  {result.routes.length} routes
                </Badge>
              </p>
              <Button
                type="button"
                size="sm"
                variant={result ? "default" : "outline"}
                onClick={applyGenerated}
              >
                {t(K.applyDraft, { defaultValue: "Remplacer le brouillon" })}
              </Button>
            </div>
            <ul className="flex flex-col gap-1">
              {result.routes.map((route) => (
                <li
                  key={route.id}
                  className="flex items-center gap-2 rounded-md px-1 py-0.5 text-xs"
                >
                  <span
                    className={cn(
                      "shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold",
                      methodBadgeClass(String(route.method)),
                    )}
                  >
                    {String(route.method).toUpperCase()}
                  </span>
                  <span className="truncate font-mono" title={route.path}>
                    {route.path}
                  </span>
                  <span className="text-muted-foreground ml-auto shrink-0 font-mono text-[10px]">
                    {(route.responses ?? []).map((r) => r.statusCode).join(" / ")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

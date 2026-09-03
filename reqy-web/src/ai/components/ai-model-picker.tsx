"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, Cpu, PenLine, Settings2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { AIProvider } from "@/lib/types";
import { loadAIProvider, loadAiModel, loadApiKey, saveAIProvider, saveAiModel } from "@/lib/config";
import { DEFAULT_MODELS } from "@/lib/ai-config";
import { STATIC_MODELS } from "@/lib/provider-models";
import { secureKeys } from "@/lib/secure-storage";

/** Ordre d'affichage des providers dans le sélecteur. */
const PROVIDER_ORDER: AIProvider[] = [
  "openai",
  "anthropic",
  "gemini",
  "deepseek",
  "openrouter",
  "grok",
  "opencode-zen",
  "custom",
  "ollama",
];

const PROVIDER_NAMES: Record<AIProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
  deepseek: "DeepSeek",
  openrouter: "OpenRouter",
  grok: "xAI Grok",
  "opencode-zen": "OpenCode Zen",
  custom: "Custom",
  ollama: "Ollama",
  // Embedding-only, jamais sélectionnable dans le chat.
  jina: "Jina",
};

interface PickerState {
  provider: AIProvider;
  model: string;
}

/**
 * Sélecteur de modèle IA du chat (style pilule Claude) :
 * - liste uniquement les providers configurés (clé présente ou Ollama) ;
 * - modèles statiques connus + modèle sauvegardé + entrée personnalisée ;
 * - la sélection bascule le provider actif ET son modèle en un geste
 *   (persisté via loadAIProvider/loadAiModel consommés par resolveAiConfig).
 */
export function AiModelPicker({ className }: { className?: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<PickerState>({ provider: "openai", model: "" });
  const [configured, setConfigured] = useState<Set<AIProvider>>(new Set());
  const [ready, setReady] = useState(false);
  const [customFor, setCustomFor] = useState<AIProvider | null>(null);
  const [customValue, setCustomValue] = useState("");
  const [customError, setCustomError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    const provider = loadAIProvider();
    const model = loadAiModel(provider) || DEFAULT_MODELS[provider] || "";
    setState({ provider, model });
    const next = new Set<AIProvider>();
    for (const p of PROVIDER_ORDER) {
      if (p === "ollama" || loadApiKey(p).length > 0) next.add(p);
    }
    // Le provider actif reste visible même sans clé (état « à configurer »).
    next.add(provider);
    setConfigured(next);
  }, []);

  // Les clés arrivent du EphemeralStore après déchiffrement async : relire
  // une fois prêt (setState dans la promesse, pas synchronement dans l'effet).
  useEffect(() => {
    let cancelled = false;
    void secureKeys.waitForReady().then(() => {
      if (!cancelled) {
        refresh();
        setReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const select = useCallback((provider: AIProvider, modelId: string) => {
    void (async () => {
      await saveAIProvider(provider);
      await saveAiModel(provider, modelId);
      setState({ provider, model: modelId || DEFAULT_MODELS[provider] || "" });
    })();
  }, []);

  const modelsFor = (p: AIProvider): Array<{ id: string; label: string }> => {
    const base = [...(STATIC_MODELS[p] ?? [])];
    const saved = loadAiModel(p);
    if (saved && !base.some((m) => m.id === saved)) base.push({ id: saved, label: saved });
    return base;
  };

  const currentLabel = !ready
    ? t("ai.modelPicker.loading")
    : state.model || (PROVIDER_NAMES[state.provider] ?? state.provider);

  const isCurrentKeyMissing =
    ready && state.provider !== "ollama" && loadApiKey(state.provider).length === 0;

  return (
    <DropdownMenu onOpenChange={(open) => open && refresh()}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex min-w-0 items-center gap-1 rounded-md border border-border/70 bg-muted/40 px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
            isCurrentKeyMissing && "border-warning/50 text-warning/90",
            className,
          )}
          aria-label={`${t("ai.modelPicker.aria")} : ${currentLabel}${isCurrentKeyMissing ? ` (${t("ai.modelPicker.keyMissing")})` : ""}`}
          title={
            isCurrentKeyMissing
              ? `${state.model || PROVIDER_NAMES[state.provider]} (${t("ai.modelPicker.keyMissing")})`
              : state.model || PROVIDER_NAMES[state.provider]
          }
          data-testid="ai-model-picker-trigger"
        >
          <span className="relative flex shrink-0">
            <Cpu className="size-3 text-primary/70" />
            {isCurrentKeyMissing && (
              <span className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-warning" />
            )}
          </span>
          <span className="max-w-[120px] truncate">{currentLabel}</span>
          <ChevronDown className="size-3 shrink-0 opacity-60" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        {PROVIDER_ORDER.filter((p) => configured.has(p)).map((p) => {
          const models = modelsFor(p);
          const isCurrentProvider = p === state.provider;
          const keyMissing = p !== "ollama" && loadApiKey(p).length === 0;
          return (
            <div key={p}>
              <DropdownMenuLabel className="flex items-center justify-between px-2 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                <span>
                  {PROVIDER_NAMES[p]}
                  {keyMissing && (
                    <span className="ml-1 normal-case text-warning/90">
                      ({t("ai.modelPicker.keyMissing")})
                    </span>
                  )}
                </span>
              </DropdownMenuLabel>
              {models.length === 0 && (
                <DropdownMenuItem
                  className="text-xs"
                  onSelect={() => {
                    setCustomFor(p);
                    setCustomValue("");
                  }}
                >
                  <PenLine className="size-3" />
                  {t("ai.modelPicker.customItem")}
                </DropdownMenuItem>
              )}
              {models.map((m) => {
                const active = isCurrentProvider && m.id === state.model;
                return (
                  <DropdownMenuItem
                    key={m.id}
                    className="gap-2 text-xs"
                    onSelect={() => {
                      setCustomFor(null);
                      select(p, m.id);
                    }}
                  >
                    <Check
                      className={cn("size-3 shrink-0", active ? "text-primary" : "invisible")}
                    />
                    <span className="min-w-0 flex-1 truncate">{m.label}</span>
                    {m.label !== m.id && (
                      <span className="shrink-0 font-mono text-[9px] text-muted-foreground/50">
                        {m.id}
                      </span>
                    )}
                  </DropdownMenuItem>
                );
              })}
              {/* Entrée personnalisée toujours disponible sous la liste */}
              {models.length > 0 && (
                <DropdownMenuItem
                  className="gap-2 text-xs text-muted-foreground"
                  onSelect={() => {
                    setCustomFor(p);
                    setCustomValue(state.provider === p ? state.model : "");
                  }}
                >
                  <PenLine className="size-3" />
                  {t("ai.modelPicker.customItem")}
                </DropdownMenuItem>
              )}
              {customFor === p && (
                <form
                  className="space-y-1 px-2 pb-2 pt-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const id = customValue.trim();
                    // P3.12 — validation minimale du format d'identifiant.
                    if (!id || /\s/.test(id)) {
                      setCustomError(t("ai.modelPicker.customInvalid"));
                      return;
                    }
                    setCustomError(null);
                    select(p, id);
                    setCustomFor(null);
                  }}
                >
                  <input
                    autoFocus
                    value={customValue}
                    onChange={(e) => {
                      setCustomValue(e.target.value);
                      setCustomError(null);
                    }}
                    placeholder={t("ai.modelPicker.customPlaceholder")}
                    className="h-7 min-w-0 w-full rounded-md border border-border bg-background px-2 font-mono text-[11px] outline-none focus-visible:border-ring/60"
                  />
                  {customError && (
                    <p className="text-[10px] text-destructive">{customError}</p>
                  )}
                  <Button type="submit" size="sm" className="h-7 w-full px-2 text-[10px]">
                    {t("common.apply")}
                  </Button>
                </form>
              )}
              <DropdownMenuSeparator />
            </div>
          );
        })}

        {configured.size < PROVIDER_ORDER.length && (
          <DropdownMenuItem asChild className="gap-2 text-xs text-muted-foreground">
            <Link href="/settings#ai">
              <Settings2 className="size-3.5" />
              {t("ai.modelPicker.manageSettings")}
            </Link>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import type { AIProvider } from "@/lib/types";
import {
  saveAIProvider,
  saveApiKey,
  saveAiBaseUrl,
  saveAiModel,
  loadApiKey,
  loadAiBaseUrl,
  loadAiModel,
} from "@/lib/config";
import { AiProviderCard, PROVIDER_INFOS, type ProviderInfo } from "./ai-provider-card";
import { AiProviderModal } from "./ai-provider-modal";
import { useTranslation } from "react-i18next";

interface AISectionProps {
  provider: AIProvider;
  apiKey: string;
  aiModel: string;
  aiBaseUrl: string;
  aiProviders: Array<{ value: AIProvider; label: string }>;
  onProviderChange: (value: AIProvider) => void;
  onSaveConfig: () => void;
  setApiKey: (val: string) => void;
  setAiModel: (val: string) => void;
  setAiBaseUrl: (val: string) => void;
  // Legacy props kept for backward compatibility
  ollamaHost?: string;
  ollamaPort?: string;
  ollamaModel?: string;
  setOllamaHost?: (val: string) => void;
  setOllamaPort?: (val: string) => void;
  setOllamaModel?: (val: string) => void;
}

export default function AISection({
  provider,
  apiKey,
  aiModel: _aiModel,
  aiBaseUrl: _aiBaseUrl,
  aiProviders,
  onProviderChange,
  onSaveConfig,
  setApiKey,
  setAiModel,
  setAiBaseUrl,
}: AISectionProps) {
  // --- Modal state ---
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedProviderInfo, setSelectedProviderInfo] = useState<ProviderInfo | null>(null);
  const { t } = useTranslation();

  // Track which providers are configured (have an API key saved) — lu depuis
  // le stockage réel pour TOUS les providers : la config est multi-provider,
  // chaque clé reste en place quand on change de provider actif.
  const [configuredProviders, setConfiguredProviders] = useState<Set<AIProvider>>(() => {
    const set = new Set<AIProvider>();
    if (apiKey) set.add(provider);
    for (const info of PROVIDER_INFOS) {
      if (info.value !== "ollama" && loadApiKey(info.value).length > 0) set.add(info.value);
    }
    return set;
  });

  const handleCardClick = (info: ProviderInfo) => {
    // Configurer un provider ne doit PAS basculer le provider actif :
    // on ouvre simplement son formulaire pré-rempli avec sa config stockée.
    setSelectedProviderInfo(info);
    setModalOpen(true);
  };

  const handleModalSave = (config: { apiKey: string; model: string; baseUrl: string }) => {
    const p = selectedProviderInfo?.value as AIProvider;
    if (!p) return;

    // 1. Persist DIRECTLY to localStorage (immediate, no stale closure risk)
    saveApiKey(p, config.apiKey);
    saveAiModel(p, config.model);
    if (p === "custom" || p === "openai") {
      saveAiBaseUrl(p, config.baseUrl);
    }

    // 2. Définir ce provider comme actif (persistance + état UI)
    if (p !== provider) {
      void saveAIProvider(p);
      onProviderChange(p);
    }
    setApiKey(config.apiKey);
    setAiModel(config.model);
    if (p === "custom" || p === "openai") {
      setAiBaseUrl(config.baseUrl);
    }

    // 3. Mark as configured + notifier les surfaces (sidebar) sans changement de page
    if (config.apiKey) {
      setConfiguredProviders((prev) => new Set(prev).add(p));
    }
    try {
      window.dispatchEvent(new CustomEvent("ai-config-changed"));
    } catch {
      /* ignore */
    }
  };

  /** Active un provider configuré sans rouvrir son formulaire. */
  const handleSetActive = (p: AIProvider) => {
    void saveAIProvider(p);
    if (p !== provider) onProviderChange(p);
    try {
      window.dispatchEvent(new CustomEvent("ai-config-changed"));
    } catch {
      /* ignore */
    }
    setModalOpen(false);
  };

  const handleModalDelete = () => {
    const p = selectedProviderInfo?.value as AIProvider;
    if (!p) return;

    // Clear persisted values
    saveApiKey(p, "");
    saveAiModel(p, "");
    if (p === "custom" || p === "openai") {
      saveAiBaseUrl(p, "");
    }

    // Update UI
    if (p === provider) {
      setApiKey("");
      setAiModel("");
      setAiBaseUrl("");
    }
    setConfiguredProviders((prev) => {
      const next = new Set(prev);
      next.delete(p);
      return next;
    });
    setModalOpen(false);
  };

  // Filter provider infos by what's in aiProviders list
  const visibleProviders = PROVIDER_INFOS.filter((info) =>
    aiProviders.some((ap) => ap.value === info.value),
  );

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-start gap-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
              <Sparkles className="size-5 text-primary" />
            </div>
            <div className="space-y-1">
              <CardTitle className="text-base">{t("settings.ai.title")}</CardTitle>
              <CardDescription>{t("settings.ai.description")}</CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Provider cards grid - 3 per row */}
          <div>
            <label className="mb-3 block text-sm font-medium text-foreground">
              {t("settings.ai.provider")}
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {visibleProviders.map((info) => (
                <AiProviderCard
                  key={info.value}
                  info={info}
                  isSelected={provider === info.value}
                  isConfigured={configuredProviders.has(info.value)}
                  onClick={() => handleCardClick(info)}
                />
              ))}
            </div>
          </div>
        </CardContent>

        <CardFooter className="border-t pt-5">
          <div className="flex items-center gap-3">
            <Button onClick={onSaveConfig}>{t("settings.ai.save")}</Button>
            <span className="text-sm text-muted-foreground">
              {t("settings.ai.activeProvider")}{" "}
              {aiProviders.find((ap) => ap.value === provider)?.label ?? provider}
            </span>
          </div>
        </CardFooter>
      </Card>

      {/* Configuration Modal — pré-rempli avec la config STOCKÉE du provider
          ciblé (pas seulement celle du provider actif) */}
      {selectedProviderInfo && (
        <AiProviderModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          providerInfo={selectedProviderInfo}
          currentApiKey={
            selectedProviderInfo.value === "ollama" ? "" : loadApiKey(selectedProviderInfo.value)
          }
          currentModel={loadAiModel(selectedProviderInfo.value)}
          currentBaseUrl={loadAiBaseUrl(selectedProviderInfo.value)}
          isActiveProvider={selectedProviderInfo.value === provider}
          onSetActive={() => handleSetActive(selectedProviderInfo.value)}
          onSave={handleModalSave}
          onDelete={handleModalDelete}
        />
      )}
    </>
  );
}

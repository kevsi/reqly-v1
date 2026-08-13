"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import type { AIProvider } from "@/lib/types";
import { persistence } from "@/lib/persistence";
import { saveAIProvider, saveApiKey, saveAiBaseUrl, saveAiModel } from "@/lib/config";
import { AiProviderCard, PROVIDER_INFOS, type ProviderInfo } from "./ai-provider-card";
import { AiProviderModal } from "./ai-provider-modal";
import { useTranslation } from "react-i18next";

interface AISectionProps {
  provider: AIProvider;
  apiKey: string;
  aiModel: string;
  aiBaseUrl: string;
  aiAutoApply: boolean | undefined;
  showAiConfirm: boolean;
  aiProviders: Array<{ value: AIProvider; label: string }>;
  onProviderChange: (value: AIProvider) => void;
  onSaveConfig: () => void;
  setApiKey: (val: string) => void;
  setAiModel: (val: string) => void;
  setAiBaseUrl: (val: string) => void;
  setAiAutoApply: (val: boolean) => void;
  setShowAiConfirm: (val: boolean) => void;
  simpleMode?: boolean;
  setSimpleMode?: (val: boolean) => void;
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
  aiModel,
  aiBaseUrl,
  aiAutoApply,
  showAiConfirm,
  aiProviders,
  onProviderChange,
  onSaveConfig,
  setApiKey,
  setAiModel,
  setAiBaseUrl,
  setAiAutoApply,
  setShowAiConfirm,
  simpleMode,
  setSimpleMode,
}: AISectionProps) {
  // --- Modal state ---
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedProviderInfo, setSelectedProviderInfo] = useState<ProviderInfo | null>(null);
  const { t } = useTranslation();

  // Track which providers are configured (have an API key saved)
  const [configuredProviders, setConfiguredProviders] = useState<Set<AIProvider>>(() => {
    // Start with the current provider if it has a key
    const set = new Set<AIProvider>();
    if (apiKey) set.add(provider);
    return set;
  });

  const handleCardClick = (info: ProviderInfo) => {
    // Load the values for the clicked provider
    if (info.value !== provider) {
      onProviderChange(info.value);
    }
    setSelectedProviderInfo(info);
    setModalOpen(true);
  };

  const handleModalSave = (config: { apiKey: string; model: string; baseUrl: string }) => {
    const p = selectedProviderInfo?.value as AIProvider;
    if (!p) return;

    // 1. Persist DIRECTLY to localStorage (immediate, no stale closure risk)
    saveAIProvider(p);
    saveApiKey(p, config.apiKey);
    saveAiModel(p, config.model);
    if (p === "custom" || p === "openai") {
      saveAiBaseUrl(p, config.baseUrl);
    }

    // 2. Update React state for the current UI
    setApiKey(config.apiKey);
    setAiModel(config.model);
    if (p === "custom" || p === "openai") {
      setAiBaseUrl(config.baseUrl);
    }
    // Switch active provider — onProviderChange reloads from localStorage,
    // but we've already saved the new values there, so it picks up the fresh data.
    if (p !== provider) {
      onProviderChange(p);
    }

    // 3. Mark as configured
    if (config.apiKey) {
      setConfiguredProviders((prev) => new Set(prev).add(p));
    }
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
    setApiKey("");
    setAiModel("");
    setAiBaseUrl("");
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

          {/* Auto-apply toggle */}
          <div className="flex items-center justify-between rounded-xl border border-border bg-muted/30 p-4">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-foreground">{t("settings.ai.autoApply")}</p>
              <p className="text-xs text-muted-foreground">{t("settings.ai.autoApplyDesc")}</p>
            </div>
            <Switch
              checked={!!aiAutoApply}
              onCheckedChange={(v) => {
                const want = Boolean(v);
                if (want) {
                  try {
                    const confirmed =
                      persistence.getItem<string>("probe_ai_autorun_confirmed") === "true";
                    if (!confirmed) {
                      setShowAiConfirm(true);
                      return;
                    }
                  } catch {
                    /* ignore */
                  }
                }
                setAiAutoApply(want);
              }}
            />
          </div>

          {/* Mode simple toggle */}
          <div className="flex items-center justify-between rounded-xl border border-border bg-muted/30 p-4">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-foreground">{t("settings.ai.simpleMode")}</p>
              <p className="text-xs text-muted-foreground">{t("settings.ai.simpleModeDesc")}</p>
            </div>
            <Switch checked={!!simpleMode} onCheckedChange={(v) => setSimpleMode?.(Boolean(v))} />
          </div>

          {/* Auto-apply confirmation dialog */}
          <Dialog open={showAiConfirm} onOpenChange={setShowAiConfirm}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("settings.ai.confirmTitle")}</DialogTitle>
                <DialogDescription>{t("settings.ai.confirmDesc")}</DialogDescription>
              </DialogHeader>
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setShowAiConfirm(false)}>
                  {t("common.cancel")}
                </Button>
                <Button
                  onClick={() => {
                    try {
                      void persistence.setItem("probe_ai_autorun_confirmed", "true");
                    } catch {
                      /* ignore */
                    }
                    setAiAutoApply(true);
                    setShowAiConfirm(false);
                  }}
                >
                  {t("settings.ai.confirmAndEnable")}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
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

      {/* Configuration Modal */}
      {selectedProviderInfo && (
        <AiProviderModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          providerInfo={selectedProviderInfo}
          currentApiKey={selectedProviderInfo.value === provider ? apiKey : ""}
          currentModel={selectedProviderInfo.value === provider ? aiModel : ""}
          currentBaseUrl={selectedProviderInfo.value === provider ? aiBaseUrl : ""}
          onSave={handleModalSave}
          onDelete={handleModalDelete}
        />
      )}
    </>
  );
}

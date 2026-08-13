"use client";

import { useEffect, useState, useCallback } from "react";
import { Loader2, RefreshCw, X, Check, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { ProviderInfo } from "./ai-provider-card";
import { STATIC_MODELS, ANTHROPIC_NO_FETCH, fetchModelsByProvider } from "@/lib/provider-models";
import type { ModelOption } from "@/lib/provider-models";
import { useTestConnection } from "@/hooks/use-test-connection";
import { ModelSearchList } from "@/components/settings/model-search-list";
import { useTranslation } from "react-i18next";

interface AiProviderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providerInfo: ProviderInfo;
  // Current saved values
  currentApiKey: string;
  currentModel: string;
  currentBaseUrl: string;
  // Save handler
  onSave: (config: { apiKey: string; model: string; baseUrl: string }) => void;
  // Delete handler
  onDelete?: () => void;
}

export function AiProviderModal({
  open,
  onOpenChange,
  providerInfo,
  currentApiKey,
  currentModel,
  currentBaseUrl,
  onSave,
  onDelete,
}: AiProviderModalProps) {
  const provider = providerInfo.value;
  const isCustom = provider === "custom";

  // -- Form state --
  const [apiKey, setApiKey] = useState(currentApiKey);
  const [baseUrl, setBaseUrl] = useState(currentBaseUrl);
  const [selectedModel, setSelectedModel] = useState(currentModel);

  // -- Model fetching state --
  const [models, setModels] = useState<ModelOption[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsFetched, setModelsFetched] = useState(false);

  // -- Test connection --
  const { testLoading, testResult, testConnection, clearTestResult } = useTestConnection();
  const { t } = useTranslation();

  // Reset form when modal opens with different provider
  useEffect(() => {
    if (open) {
      setApiKey(currentApiKey);
      setBaseUrl(currentBaseUrl);
      setSelectedModel(currentModel);
      setModels([]);
      setModelsFetched(false);
      setLoadingModels(false);
      clearTestResult();
    }
  }, [open, provider, currentApiKey, currentModel, currentBaseUrl, clearTestResult]);

  // Auto-fetch models after typing API key (same as existing AISection)
  const handleFetchModels = useCallback(async () => {
    if (loadingModels) return;
    setLoadingModels(true);
    try {
      let result: ModelOption[];

      if (ANTHROPIC_NO_FETCH.has(provider)) {
        result = STATIC_MODELS[provider] ?? [];
        toast.info(t("settings.ai.modal.staticList"));
      } else {
        result = await fetchModelsByProvider({ provider, apiKey, baseUrl, isCustom });
      }

      // Merge with any manually added models
      setModels((prev) => {
        const existingIds = new Set(prev.map((m) => m.id));
        const newModels = result.filter((m) => !existingIds.has(m.id));
        return [...prev, ...newModels];
      });
      setModelsFetched(true);
      if (result.length > 0) {
        toast.success(t("settings.ai.modal.modelsLoaded", { count: result.length }));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const fallback = STATIC_MODELS[provider] ?? [];
      if (fallback.length > 0) {
        setModels((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const newModels = fallback.filter((m) => !existingIds.has(m.id));
          return [...prev, ...newModels];
        });
      }
      setModelsFetched(true);
      toast.warning(
        `${t("settings.ai.modal.loadFailed", { message })}${
          fallback.length > 0
            ? t("settings.ai.modal.loadFailedFallback", { count: fallback.length })
            : ""
        }`,
      );
    } finally {
      setLoadingModels(false);
    }
  }, [provider, apiKey, baseUrl, isCustom, loadingModels, t]);

  // Auto-fetch models after typing API key (same as existing AISection)
  useEffect(() => {
    if (!apiKey || provider === "ollama" || ANTHROPIC_NO_FETCH.has(provider)) return;
    if (isCustom && !baseUrl.trim()) return;

    const timeout = setTimeout(() => {
      void handleFetchModels();
    }, 1000);

    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, provider, baseUrl]);

  const handleAddModel = useCallback(
    (modelId: string) => {
      setModels((prev) => [...prev, { id: modelId, label: modelId }]);
      setSelectedModel(modelId);
      toast.success(t("settings.ai.modal.modelAdded", { model: modelId }));
    },
    [t],
  );

  const handleRemoveModel = useCallback((modelId: string) => {
    setModels((prev) => prev.filter((m) => m.id !== modelId));
    setSelectedModel((prev) => (prev === modelId ? "" : prev));
  }, []);

  const handleTestClick = useCallback(() => {
    void testConnection({
      provider,
      apiKey,
      model: selectedModel,
      baseUrl,
      isCustom,
    });
  }, [testConnection, provider, apiKey, selectedModel, baseUrl, isCustom]);

  const handleSave = () => {
    onSave({
      apiKey,
      model: selectedModel,
      baseUrl: isCustom ? baseUrl : "",
    });
    onOpenChange(false);
  };

  const hasApiKey = Boolean(apiKey || provider === "ollama");
  const hasModel = Boolean(selectedModel || provider === "ollama");

  const FallbackIcon = providerInfo.fallbackIcon;
  const BrandIcon = providerInfo.brandIcon;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl overflow-hidden" style={{ padding: 0, gap: 0 }}>
        {/* Header */}
        <div className="flex items-start gap-4 border-b border-border px-6 pt-6 pb-4">
          <div
            className={cn(
              "flex size-12 shrink-0 items-center justify-center rounded-xl overflow-hidden",
              "bg-gradient-to-br",
              providerInfo.gradient,
            )}
          >
            {BrandIcon ? (
              <BrandIcon
                className="max-h-7 max-w-7 h-auto w-auto"
                aria-label={providerInfo.label}
              />
            ) : (
              <FallbackIcon className="size-6 text-primary" />
            )}
          </div>
          <div className="flex-1 space-y-1">
            <DialogTitle className="text-lg">{providerInfo.label}</DialogTitle>
            <DialogDescription className="text-sm">
              {isCustom
                ? t("settings.ai.modal.customDesc")
                : t("settings.ai.modal.configureDesc", { provider: providerInfo.label })}
            </DialogDescription>
          </div>
        </div>

        {/* Body */}
        <div className="space-y-5 px-6 py-5 max-h-[60vh] overflow-y-auto">
          {/* Base URL - only for custom provider */}
          {isCustom && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                {t("settings.ai.modal.baseUrl")}
              </label>
              <Input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.example.com/v1"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {t("settings.ai.modal.baseUrlHint")}{" "}
                <code className="text-xs">https://api.g0i.ai/v1</code>
              </p>
            </div>
          )}

          {/* API Key */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              {t("settings.ai.modal.apiKey")}
            </label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                provider === "ollama"
                  ? t("settings.ai.modal.notRequired")
                  : t("settings.ai.modal.enterApiKey")
              }
              disabled={provider === "ollama"}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {provider === "ollama"
                ? t("settings.ai.modal.ollamaLocal")
                : t("settings.ai.modal.keyStoredLocal")}
            </p>
          </div>

          {/* Model Selection */}
          <ModelSearchList
            models={models}
            selectedModelId={selectedModel}
            onModelSelect={setSelectedModel}
            provider={provider}
            isCustom={isCustom}
            onFetchModels={handleFetchModels}
            fetchingModels={loadingModels}
            modelsFetched={modelsFetched}
            apiKey={apiKey}
            baseUrl={baseUrl}
            onAddModel={handleAddModel}
            onRemoveModel={handleRemoveModel}
          />
        </div>

        {/* Test result banner (between body and footer) */}
        {testResult && (
          <div
            className={cn(
              "flex items-center gap-2 px-6 py-2.5 text-sm border-t border-dashed max-w-full",
              testResult.success
                ? "bg-success/10 text-success border-success/30"
                : "bg-destructive/10 text-destructive border-destructive/30",
            )}
          >
            {testResult.success ? (
              <Check className="size-4 shrink-0" />
            ) : (
              <AlertCircle className="size-4 shrink-0" />
            )}
            <span
              className="flex-1 max-w-[180px] text-xs leading-relaxed"
              title={testResult.message}
            >
              {testResult.message}
            </span>
            <button
              type="button"
              onClick={clearTestResult}
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}

        {/* Spacer if test result exists */}
        {testResult && <div className="h-2" />}

        {/* Footer */}
        <DialogFooter className="border-t border-border px-6 py-4">
          <div className="flex w-full items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {onDelete && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onDelete}
                  className="text-muted-foreground hover:text-destructive"
                >
                  {t("settings.ai.modal.deleteConfig")}
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleTestClick}
                disabled={testLoading || !hasApiKey || !hasModel || (isCustom && !baseUrl.trim())}
              >
                {testLoading ? (
                  <>
                    <Loader2 className="mr-1.5 size-3 animate-spin" />
                    {t("settings.ai.modal.testing")}
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-1.5 size-3" />
                    {t("settings.ai.modal.test")}
                  </>
                )}
              </Button>
              <Button variant="outline" onClick={() => onOpenChange(false)} size="sm">
                {t("common.cancel")}
              </Button>
              <Button onClick={handleSave} size="sm">
                {t("settings.ai.save")}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

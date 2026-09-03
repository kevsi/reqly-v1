"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Loader2,
  RefreshCw,
  X,
  Check,
  AlertCircle,
  Eye,
  EyeOff,
  Sparkles,
  KeyRound,
  Link2,
  Cpu,
  ShieldCheck,
} from "lucide-react";
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
import { loadRecentModels, saveRecentModel } from "@/lib/config";
import { useTranslation } from "react-i18next";

interface AiProviderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providerInfo: ProviderInfo;
  currentApiKey: string;
  currentModel: string;
  currentBaseUrl: string;
  onSave: (config: { apiKey: string; model: string; baseUrl: string }) => void;
  onDelete?: () => void;
  /** Ce provider est-il le provider actif ? */
  isActiveProvider?: boolean;
  /** Définir ce provider comme actif (sans changer sa config). */
  onSetActive?: () => void;
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
  isActiveProvider = false,
  onSetActive,
}: AiProviderModalProps) {
  const provider = providerInfo.value;
  const isCustom = provider === "custom";

  // -- Form state --
  const [apiKey, setApiKey] = useState(currentApiKey);
  const [baseUrl, setBaseUrl] = useState(currentBaseUrl);
  const [selectedModel, setSelectedModel] = useState(currentModel);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // -- Model fetching state --
  const [models, setModels] = useState<ModelOption[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsFetched, setModelsFetched] = useState(false);
  const [recentModelIds, setRecentModelIds] = useState<string[]>([]);

  // -- Test connection --
  const { testLoading, testResult, testConnection, clearTestResult } = useTestConnection();
  const { t } = useTranslation();

  // Reset form when modal opens with different provider
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      setApiKey(currentApiKey);
      setBaseUrl(currentBaseUrl);
      setSelectedModel(currentModel);
      setRecentModelIds(loadRecentModels(provider));
      // pré-charger les modèles statiques pour ce provider afin que la liste ne soit pas vide avant fetch
      const statics = STATIC_MODELS[provider] ?? [];
      setModels(statics.length ? statics : []);
      setModelsFetched(statics.length > 0);
      setLoadingModels(false);
      setShowDeleteConfirm(false);
      clearTestResult();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open, provider, currentApiKey, currentModel, currentBaseUrl, clearTestResult]);

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

  const hasApiKey = Boolean(apiKey || provider === "ollama");
  const hasModel = Boolean(selectedModel || provider === "ollama");
  const hasValidBaseUrl = !isCustom || baseUrl.trim().length > 0;
  const canSave = hasApiKey && hasModel && hasValidBaseUrl;

  const handleSave = () => {
    if (!canSave) {
      toast.error(
        t("settings.ai.modal.incompleteForm", "Complète les champs requis avant d'enregistrer."),
      );
      return;
    }
    if (selectedModel) void saveRecentModel(provider, selectedModel);
    onSave({
      apiKey,
      model: selectedModel,
      baseUrl: isCustom ? baseUrl : "",
    });
    onOpenChange(false);
  };

  const FallbackIcon = providerInfo.fallbackIcon;
  const BrandIcon = providerInfo.brandIcon;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "sm:max-w-2xl w-[calc(100vw-2rem)] !overflow-hidden p-0 gap-0 !max-h-[calc(100dvh-2rem)]",
          "border-border/70 bg-background/95 shadow-2xl shadow-black/10 backdrop-blur-xl",
          "[&>button]:top-4 [&>button]:right-4 [&>button]:z-20 [&>button]:rounded-full",
          "[&>button]:p-1.5 [&>button]:bg-background/70 [&>button]:border [&>button]:border-border/60",
          "[&>button]:opacity-70 [&>button]:hover:opacity-100 [&>button]:hover:bg-muted",
          "[&>button]:transition-all",
        )}
        style={{ display: "flex", flexDirection: "column" }}
      >
        {/* Premium header */}
        <div className="relative overflow-hidden border-b border-border/70">
          <div
            className={cn("absolute inset-0 opacity-20 bg-gradient-to-br", providerInfo.gradient)}
          />
          <div className="relative flex items-start gap-4 px-6 pb-5 pt-6 sm:px-7 sm:pt-7">
            <div
              className={cn(
                "relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl",
                "border border-white/20 bg-gradient-to-br shadow-lg ring-1 ring-black/5",
                providerInfo.gradient,
              )}
            >
              <div className="absolute inset-0 bg-white/10" />
              {BrandIcon ? (
                <BrandIcon className="relative size-7" aria-label={providerInfo.label} />
              ) : (
                <FallbackIcon className="relative size-6 text-primary" />
              )}
            </div>

            <div className="min-w-0 flex-1 pr-8">
              <div className="mb-1 flex items-center gap-2">
                <DialogTitle className="truncate text-xl font-semibold tracking-tight">
                  {providerInfo.label}
                </DialogTitle>
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border/70 bg-background/70 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  <Sparkles className="size-3" />
                  AI
                </span>
              </div>
              <DialogDescription className="max-w-xl text-sm leading-6 text-muted-foreground">
                {isCustom
                  ? t("settings.ai.modal.customDesc")
                  : t("settings.ai.modal.configureDesc", { provider: providerInfo.label })}
              </DialogDescription>
            </div>
          </div>

          <div className="relative flex items-center gap-2 border-t border-border/50 bg-background/40 px-6 py-2.5 text-[11px] text-muted-foreground sm:px-7">
            <ShieldCheck className="size-3.5 shrink-0" />
            <span>{t("settings.ai.modal.keyStoredLocal")}</span>
          </div>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
          {/* Connection section */}
          <section className="rounded-2xl border border-border/70 bg-muted/20 p-4 sm:p-5">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-xl border border-border/70 bg-background shadow-sm">
                <Link2 className="size-4 text-primary" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">Connexion</h3>
                <p className="text-xs text-muted-foreground">
                  Configurez les paramètres d'accès du fournisseur.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              {/* Base URL - only for custom provider */}
              {isCustom && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t("settings.ai.modal.baseUrl")}
                  </label>
                  <div className="relative">
                    <Link2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/60" />
                    <Input
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                      placeholder="https://api.example.com/v1"
                      className={cn(
                        "h-11 rounded-xl border-border/70 bg-background pl-9 shadow-sm transition-all",
                        "focus-visible:ring-2 focus-visible:ring-primary/20",
                        !baseUrl.trim() &&
                          "border-destructive/40 focus-visible:ring-destructive/20",
                      )}
                    />
                  </div>
                  <p className="mt-1.5 text-xs leading-5 text-muted-foreground break-words">
                    {t("settings.ai.modal.baseUrlHint")}{" "}
                    <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
                      https://api.g0i.ai/v1
                    </code>
                  </p>
                </div>
              )}

              {/* API Key */}
              <div>
                <label
                  htmlFor="ai-api-key"
                  className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground"
                >
                  {t("settings.ai.modal.apiKey")}
                </label>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/60" />
                  <Input
                    id="ai-api-key"
                    type={showApiKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={
                      provider === "ollama"
                        ? t("settings.ai.modal.notRequired")
                        : t("settings.ai.modal.enterApiKey")
                    }
                    disabled={provider === "ollama"}
                    autoComplete="off"
                    spellCheck={false}
                    className="h-11 rounded-xl border-border/70 bg-background pl-9 pr-11 shadow-sm transition-all focus-visible:ring-2 focus-visible:ring-primary/20"
                  />
                  {provider !== "ollama" && apiKey && (
                    <button
                      type="button"
                      onClick={() => setShowApiKey((v) => !v)}
                      className="absolute right-2.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
                      aria-label={
                        showApiKey ? t("settings.ai.modal.hideKey") : t("settings.ai.modal.showKey")
                      }
                      title={
                        showApiKey ? t("settings.ai.modal.hideKey") : t("settings.ai.modal.showKey")
                      }
                    >
                      {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  )}
                </div>
                <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <ShieldCheck className="size-3.5" />
                  <span>
                    {provider === "ollama"
                      ? t("settings.ai.modal.ollamaLocal")
                      : t("settings.ai.modal.keyStoredLocal")}
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* Model section */}
          <section className="rounded-2xl border border-border/70 bg-muted/20 p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-xl border border-border/70 bg-background shadow-sm">
                  <Cpu className="size-4 text-primary" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">Modèle</h3>
                  <p className="text-xs text-muted-foreground">
                    Sélectionnez le modèle utilisé par ce fournisseur.
                  </p>
                </div>
              </div>
              {selectedModel && (
                <span className="hidden max-w-[45%] truncate rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-[10px] font-medium text-primary sm:block">
                  {selectedModel}
                </span>
              )}
            </div>

            <ModelSearchList
              models={models}
              selectedModelId={selectedModel}
              onModelSelect={(id) => {
                setSelectedModel(id);
                if (id) void saveRecentModel(provider, id);
              }}
              provider={provider}
              isCustom={isCustom}
              onFetchModels={handleFetchModels}
              fetchingModels={loadingModels}
              modelsFetched={modelsFetched}
              apiKey={apiKey}
              baseUrl={baseUrl}
              recentModelIds={recentModelIds}
              onAddModel={handleAddModel}
              onRemoveModel={handleRemoveModel}
            />
          </section>
        </div>

        {/* Test result banner */}
        {testResult && (
          <div
            className={cn(
              "flex items-start gap-3 border-t px-5 py-3.5 sm:px-7",
              testResult.success
                ? "border-success/20 bg-success/10 text-success"
                : "border-destructive/20 bg-destructive/10 text-destructive",
            )}
          >
            <div
              className={cn(
                "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full",
                testResult.success ? "bg-success/15" : "bg-destructive/15",
              )}
            >
              {testResult.success ? (
                <Check className="size-4" />
              ) : (
                <AlertCircle className="size-4" />
              )}
            </div>
            <span className="min-w-0 flex-1 self-center text-xs leading-5 break-words">
              {testResult.message}
            </span>
            <button
              type="button"
              onClick={clearTestResult}
              className="shrink-0 rounded-lg p-1.5 text-muted-foreground/70 transition-colors hover:bg-background/50 hover:text-foreground"
              aria-label={t("common.close", "Fermer")}
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}

        {/* Footer */}
        <DialogFooter className="border-t border-border/70 bg-muted/15 px-5 py-4 sm:px-7">
          <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center">
              {onDelete &&
                (showDeleteConfirm ? (
                  <div className="flex items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/5 p-1.5">
                    <span className="px-2 text-xs text-muted-foreground">
                      {t("settings.ai.modal.confirmDelete", "Confirmer ?")}
                    </span>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={onDelete}
                      className="rounded-lg"
                    >
                      {t("common.confirm", "Oui")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowDeleteConfirm(false)}
                      className="rounded-lg"
                    >
                      {t("common.cancel")}
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowDeleteConfirm(true)}
                    className="rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    {t("settings.ai.modal.deleteConfig")}
                  </Button>
                ))}
            </div>

            <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row sm:items-center">
              <Button
                variant="outline"
                size="sm"
                onClick={handleTestClick}
                disabled={testLoading || !hasApiKey || !hasModel || (isCustom && !baseUrl.trim())}
                className="h-10 rounded-xl border-border/70 bg-background px-4 shadow-sm"
              >
                {testLoading ? (
                  <>
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                    {t("settings.ai.modal.testing")}
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-1.5 size-3.5" />
                    {t("settings.ai.modal.test")}
                  </>
                )}
              </Button>
              <Button
                variant="ghost"
                onClick={() => onOpenChange(false)}
                size="sm"
                className="h-10 rounded-xl px-4"
              >
                {t("common.cancel")}
              </Button>
              <Button
                onClick={handleSave}
                size="sm"
                disabled={!canSave}
                className="h-10 rounded-xl px-5 shadow-sm"
              >
                <Check className="mr-1.5 size-3.5" />
                {t("settings.ai.save")}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

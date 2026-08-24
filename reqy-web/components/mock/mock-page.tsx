"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, FileDown, FileUp, Layers, Plus, Upload } from "lucide-react";
import type { MockConfig } from "@reqly/mock-engine";
import {
  checkMockAlive,
  clearMockAdminSettings,
  loadMockAdminSettings,
  pushMockConfig,
  resetMockState,
  saveMockAdminSettings,
  type MockAdminSettings,
} from "@/lib/mock/admin-client";
import { collectionsToMockConfig, loadMockDraft, saveMockDraft } from "@/lib/mock/convert";
import { useRequestStore } from "@/hooks/use-request-store";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useTranslation } from "react-i18next";
import { CollectionsGenerateModal } from "./collections-generate-modal";
import { MockLogs } from "./mock-logs";
import { MockStatusBar, type AttachState } from "./mock-status-bar";
import { RouteEditor } from "./route-editor";
import { RouteList } from "./route-list";
import {
  createExampleConfig,
  downloadMockConfig,
  duplicateRoute,
  makeRoute,
  sanitizeConfig,
} from "./mock-utils";

const K = {
  pageTitle: "mocks.pageTitle",
  draftSaved: "mocks.editor.draftSaved",
  newRoute: "mocks.actions.newRoute",
  generate: "mocks.actions.generate",
  importJson: "mocks.actions.importJson",
  exportJson: "mocks.actions.exportJson",
  copyCmd: "mocks.actions.copyCmd",
  apply: "mocks.actions.apply",
  applySuccess: "mocks.actions.applySuccess",
  applyFailed: "mocks.actions.applyFailed",
  copiedCmd: "mocks.actions.copiedCmd",
  copyFailed: "mocks.actions.copyFailed",
  imported: "mocks.actions.imported",
  importInvalid: "mocks.actions.importInvalid",
  replaceTitle: "mocks.replace.title",
  replaceDesc: "mocks.replace.description",
  connectedToast: "mocks.status.connectedToast",
  connectFailedToast: "mocks.status.connectFailedToast",
  disconnectedToast: "mocks.status.disconnectedToast",
  resetOkToast: "mocks.status.resetOkToast",
  resetKoToast: "mocks.status.resetKoToast",
  resetConfirmTitle: "mocks.status.resetConfirmTitle",
  resetConfirmDesc: "mocks.status.resetConfirmDesc",
  resetStateLabel: "mocks.status.resetStateLabel",
  emptyTitle: "mocks.empty.title",
  emptyDesc: "mocks.empty.description",
  emptyCta: "mocks.empty.cta",
  deleteRouteToast: "mocks.routes.deletedToast",
  generatedToast: "mocks.generate.generatedToast",
} as const;

export function MockPage() {
  const { t } = useTranslation();
  const [attach, setAttach] = useState<AttachState>({
    status: "unknown",
    name: null,
    routesCount: 0,
  });
  const [settings, setSettings] = useState<MockAdminSettings | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [pollingActive, setPollingActive] = useState(true);
  const [config, setConfig] = useState<MockConfig | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [pendingReplace, setPendingReplace] = useState<MockConfig | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const collections = useRequestStore((s) => s.collections);

  // Hydratation initiale : settings admin + brouillon > exemple embarqué.
  useEffect(() => {
    const saved = loadMockAdminSettings();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSettings(saved);
    setConnectOpen(!saved);
    if (!saved) {
      setAttach({ status: "offline", name: null, routesCount: 0 });
      return;
    }
    void (async () => {
      const alive = await checkMockAlive(saved);
      if (alive) {
        setAttach({ status: "connected", name: alive.name, routesCount: alive.routesCount });
      } else {
        setAttach({ status: "offline", name: null, routesCount: 0 });
      }
    })();
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConfig(loadMockDraft() ?? createExampleConfig());
  }, []);

  // Autosave du brouillon (debounce 600 ms).
  useEffect(() => {
    if (!config) return;
    const handle = window.setTimeout(() => {
      saveMockDraft(config);
      const now = new Date();
      setDraftSavedAt(
        `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
      );
    }, 600);
    return () => window.clearTimeout(handle);
  }, [config]);

  const routes = config?.routes ?? [];
  const selectedRoute =
    routes.find((r) => r.id === selectedRouteId) ?? (routes.length > 0 ? routes[0] : undefined);

  const handleConnect = useCallback(
    async (base: string, token: string): Promise<boolean> => {
      const candidate: MockAdminSettings = {
        base: base.trim().replace(/\/+$/, ""),
        token: token.trim(),
      };
      const alive = await checkMockAlive(candidate);
      if (!alive) {
        setAttach({ status: "offline", name: null, routesCount: 0 });
        toast({
          title: t(K.connectFailedToast, {
            defaultValue: "Mock introuvable — vérifie l'URL et le token.",
          }),
          variant: "destructive",
        });
        return false;
      }
      saveMockAdminSettings(candidate);
      setSettings(candidate);
      setAttach({ status: "connected", name: alive.name, routesCount: alive.routesCount });
      toast({
        title: t(K.connectedToast, { defaultValue: "Mock connecté" }),
        description: candidate.base,
      });
      return true;
    },
    [t],
  );

  function handleDisconnect() {
    clearMockAdminSettings();
    setSettings(null);
    setAttach({ status: "offline", name: null, routesCount: 0 });
    setConnectOpen(true);
    toast({ title: t(K.disconnectedToast, { defaultValue: "Mock déconnecté" }) });
  }

  async function handleReset() {
    if (!settings) return;
    const ok = await resetMockState(settings);
    toast({
      title: ok
        ? t(K.resetOkToast, { defaultValue: "État du mock réinitialisé" })
        : t(K.resetKoToast, { defaultValue: "Reset impossible" }),
      variant: ok ? "default" : "destructive",
    });
  }

  async function handleApply() {
    if (!settings || !config) return;
    const result = await pushMockConfig(settings, config);
    toast({
      title: result.ok
        ? t(K.applySuccess, { defaultValue: "Config appliquée au mock" })
        : t(K.applyFailed, {
            defaultValue: "Application impossible : {{message}}",
            message: result.message ?? `HTTP ${result.status}`,
          }),
      variant: result.ok ? "default" : "destructive",
    });
  }

  function updateConfig(updater: (prev: MockConfig) => MockConfig) {
    setConfig((prev) => (prev ? updater(prev) : prev));
  }

  function requestReplace(next: MockConfig) {
    if ((config?.routes.length ?? 0) > 0) setPendingReplace(next);
    else doReplace(next);
  }

  function doReplace(next: MockConfig) {
    setConfig(next);
    setSelectedRouteId(next.routes[0]?.id ?? null);
  }

  async function handleImportFile(file: File) {
    let parsed: unknown;
    try {
      const text = await file.text();
      try {
        parsed = JSON.parse(text);
      } catch {
        // Fallback YAML (js-yaml présent dans les deps web).
        const yaml = await import("js-yaml");
        parsed = yaml.load(text);
      }
    } catch {
      parsed = null;
    }
    const clean = sanitizeConfig(parsed);
    if (!clean) {
      toast({
        title: t(K.importInvalid, {
          defaultValue: "Fichier invalide : version 1 et routes requises.",
        }),
        variant: "destructive",
      });
      return;
    }
    requestReplace(clean);
    toast({ title: t(K.imported, { defaultValue: "Config importée" }) });
  }

  function handleCopyCmd() {
    navigator.clipboard
      .writeText("recli mock start mock.config.json")
      .then(() => toast({ title: t(K.copiedCmd, { defaultValue: "Commande copiée" }) }))
      .catch(() =>
        toast({
          title: t(K.copyFailed, { defaultValue: "Copie impossible" }),
          variant: "destructive",
        }),
      );
  }

  function addRoute() {
    const route = makeRoute("GET", "/nouvelle-route");
    updateConfig((prev) => ({ ...prev, routes: [...prev.routes, route] }));
    setSelectedRouteId(route.id);
  }

  function duplicateRouteById(id: string) {
    const source = routes.find((r) => r.id === id);
    if (!source || !config) return;
    const copy = duplicateRoute(source);
    const index = routes.findIndex((r) => r.id === id);
    const nextRoutes = [...routes];
    nextRoutes.splice(index + 1, 0, copy);
    setConfig({ ...config, routes: nextRoutes });
    setSelectedRouteId(copy.id);
  }

  function deleteRouteById(id: string) {
    updateConfig((prev) => ({ ...prev, routes: prev.routes.filter((r) => r.id !== id) }));
    if (selectedRouteId === id) setSelectedRouteId(null);
    toast({ title: t(K.deleteRouteToast, { defaultValue: "Route supprimée" }) });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MockStatusBar
        attach={attach}
        settings={settings}
        connectOpen={connectOpen}
        onConnectOpenChange={setConnectOpen}
        pollingActive={pollingActive}
        onTogglePolling={() => setPollingActive((v) => !v)}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
        onReset={() => setResetOpen(true)}
      />

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4 scrollbar-discreet">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold">
              {t(K.pageTitle, { defaultValue: "Mock Server" })}
            </h1>
            {draftSavedAt && (
              <p className="text-[11px] text-muted-foreground">
                ✓{" "}
                {t(K.draftSaved, {
                  defaultValue: "Brouillon sauvegardé à {{time}}",
                  time: draftSavedAt,
                })}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button type="button" size="sm" className="h-8 text-xs" onClick={addRoute}>
              <Plus aria-hidden="true" className="size-3.5" />
              {t(K.newRoute, { defaultValue: "Nouvelle route" })}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => setGenerateOpen(true)}
            >
              <Layers aria-hidden="true" className="size-3.5" />
              {t(K.generate, { defaultValue: "Générer depuis collection" })}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => fileInputRef.current?.click()}
            >
              <FileUp aria-hidden="true" className="size-3.5" />
              {t(K.importJson, { defaultValue: "Importer JSON" })}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              disabled={!config}
              onClick={() => config && downloadMockConfig(config)}
            >
              <FileDown aria-hidden="true" className="size-3.5" />
              {t(K.exportJson, { defaultValue: "Exporter .json" })}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={handleCopyCmd}
            >
              <Copy aria-hidden="true" className="size-3.5" />
              {t(K.copyCmd, { defaultValue: "Copier cmd" })}
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-8 text-xs"
              disabled={!settings || attach.status !== "connected" || !config}
              onClick={() => void handleApply()}
            >
              <Upload aria-hidden="true" className="size-3.5" />
              {t(K.apply, { defaultValue: "Appliquer au mock" })}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.yaml,.yml,application/json,text/yaml,application/x-yaml"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleImportFile(file);
                e.target.value = "";
              }}
              aria-label={t(K.importJson, { defaultValue: "Importer JSON" })}
            />
          </div>
        </div>

        {!config ? (
          <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed p-10 text-sm text-muted-foreground">
            ⋯
          </div>
        ) : routes.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-muted/20 px-6 py-14 text-center">
            <p className="text-sm font-medium">
              {t(K.emptyTitle, { defaultValue: "Aucune route dans cette config" })}
            </p>
            <p className="max-w-md text-xs text-muted-foreground">
              {t(K.emptyDesc, {
                defaultValue:
                  "Crée une route manuellement ou génère une config complète depuis tes collections Reqly.",
              })}
            </p>
            <div className="flex gap-2">
              <Button type="button" size="sm" className="h-8 text-xs" onClick={addRoute}>
                <Plus aria-hidden="true" className="size-3.5" />
                {t(K.newRoute, { defaultValue: "Nouvelle route" })}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setGenerateOpen(true)}
              >
                <Layers aria-hidden="true" className="size-3.5" />
                {t(K.emptyCta, { defaultValue: "Générer depuis une collection" })}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 lg:flex-row">
            <RouteList
              routes={routes}
              selectedId={selectedRoute?.id ?? null}
              onSelect={setSelectedRouteId}
              onDelete={deleteRouteById}
              onDuplicate={duplicateRouteById}
            />
            {selectedRoute ? (
              <RouteEditor
                key={selectedRoute.id}
                route={selectedRoute}
                onChange={(patch) =>
                  updateConfig((prev) => ({
                    ...prev,
                    routes: prev.routes.map((r) =>
                      r.id === selectedRoute.id ? { ...r, ...patch } : r,
                    ),
                  }))
                }
              />
            ) : null}
          </div>
        )}

        <MockLogs
          settings={settings}
          attached={attach.status === "connected"}
          pollingActive={pollingActive}
          onTogglePolling={() => setPollingActive((v) => !v)}
        />
      </div>

      <CollectionsGenerateModal
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        onConfirm={(ids) => {
          const selectedCollections = ids
            .map((id) => collections.find((c) => c.id === id))
            .filter((c) => c !== undefined);
          if (selectedCollections.length === 0) return;
          const next = collectionsToMockConfig(selectedCollections, {
            name: config?.name,
            port: config?.port ?? 4015,
            cors: true,
          });
          requestReplace(next);
          toast({ title: t(K.generatedToast, { defaultValue: "Routes générées" }) });
        }}
      />

      <ConfirmDialog
        open={pendingReplace !== null}
        onOpenChange={(open) => {
          if (!open) setPendingReplace(null);
        }}
        title={t(K.replaceTitle, { defaultValue: "Remplacer les routes actuelles ?" })}
        description={t(K.replaceDesc, {
          defaultValue: "Les {{count}} routes existantes seront remplacées par la nouvelle config.",
          count: config?.routes.length ?? 0,
        })}
        confirmLabel={t(K.apply, { defaultValue: "Appliquer au mock" })}
        variant="default"
        onConfirm={() => {
          if (pendingReplace) doReplace(pendingReplace);
          setPendingReplace(null);
        }}
      />

      <ConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title={t(K.resetConfirmTitle, { defaultValue: "Réinitialiser l'état du mock ?" })}
        description={t(K.resetConfirmDesc, {
          defaultValue: "Toutes les ressources stateful enregistrées seront effacées.",
        })}
        confirmLabel={t(K.resetStateLabel, { defaultValue: "Reset state" })}
        onConfirm={() => void handleReset()}
      />
    </div>
  );
}

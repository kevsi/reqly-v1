"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Boxes, Copy, Loader2, PlugZap, Plus, Terminal } from "lucide-react";
import type { ImperativePanelHandle } from "react-resizable-panels";
import type { MockConfig } from "@reqly/mock-engine";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { MockLogs } from "./mock-logs";
import { MockStatusBar } from "./mock-status-bar";
import { PageToolbar } from "./page-toolbar";
import { RouteEditor } from "./route-editor";
import { RouteList } from "./route-list";
import { downloadMockConfig } from "./mock-utils";
import {
  loadMocksLayout,
  saveMocksLayout,
  type MocksLayout,
} from "./mock-layout";
import { MocksWorkspace } from "./mocks-workspace";
import { SimpleModePanel } from "./simple-mode-panel";
import { SavedConfigsPanel } from "./saved-configs-panel";
import {
  addSavedConfig,
  loadSavedConfigs,
  removeSavedConfig,
  type SavedMockConfig,
} from "./saved-configs";
import { MocksDialogs } from "./mocks-dialogs";
import { useMockAdmin } from "./use-mock-admin";
import { useMockRoutes } from "./use-mock-routes";

const K = {
  copiedCmd: "mocks.actions.copiedCmd",
  copyFailed: "mocks.actions.copyFailed",
  emptyTitle: "mocks.empty.title",
  emptyDesc: "mocks.empty.description",
  newRoute: "mocks.actions.newRoute",
  offlineBanner: "mocks.offline.banner",
  offlineOpenForm: "mocks.offline.openForm",
} as const;

const LAYOUT_SAVE_DEBOUNCE_MS = 250;
const COPY_CMD = "recli mock start mock.config.json";
const SIMPLE_MODE_KEY = "reqly-mocks-simple-mode";

/** Empreinte stable du brouillon — sert à détecter la divergence avec le mock appliqué. */
function configSnapshot(config: MockConfig): string {
  return JSON.stringify(config);
}

export function MockPage() {
  const { t } = useTranslation();
  const isMobile = useIsMobileSafe();
  const [generateOpen, setGenerateOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [logsCollapsed, setLogsCollapsed] = useState(false);
  /** Empreinte de la dernière config connue comme appliquée au mock (null = jamais connecté). */
  const [appliedSnapshot, setAppliedSnapshot] = useState<string | null>(null);
  /** Mode simple IA — persisté pour que les devs pressés retrouvent leur vue. */
  const [simpleMode, setSimpleMode] = useState(false);
  /** Librairie de configs (générations IA + brouillons sauvegardés). */
  const [savedConfigs, setSavedConfigs] = useState<SavedMockConfig[]>([]);

  const store = useMockRoutes();
  const admin = useMockAdmin(store.config);

  const leftPanelRef = useRef<ImperativePanelHandle>(null);
  const logsPanelRef = useRef<ImperativePanelHandle>(null);
  const layoutRef = useRef<MocksLayout>({});
  const layoutTimerRef = useRef<number | null>(null);

  // Le brouillon diverge du mock dès qu'il diffère du dernier snapshot appliqué.
  const draftDirty = useMemo(() => {
    if (!store.config || appliedSnapshot === null) return false;
    return configSnapshot(store.config) !== appliedSnapshot;
  }, [store.config, appliedSnapshot]);

  // Restaure les tailles de panneaux + le mode simple depuis localStorage après montage.
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration from storage (SSR-safe)
      setSimpleMode(window.localStorage.getItem(SIMPLE_MODE_KEY) === "true");
    } catch {
      /* private mode */
    }
    setSavedConfigs(loadSavedConfigs());
    const layout = loadMocksLayout();
    if (layout.left != null) leftPanelRef.current?.resize(layout.left);
    if (layout.logs != null) logsPanelRef.current?.resize(layout.logs);
    if (layout.logsCollapsed) {
      logsPanelRef.current?.collapse();
      setLogsCollapsed(true);
    }
  }, []);

  function handleSimpleModeChange(next: boolean) {
    setSimpleMode(next);
    try {
      window.localStorage.setItem(SIMPLE_MODE_KEY, next ? "true" : "false");
    } catch {
      /* private mode */
    }
  }

  function handleConfigGenerated(config: MockConfig) {
    setSavedConfigs(addSavedConfig(config, "ai"));
  }

  function handleSaveCurrentDraft() {
    if (!store.config) return;
    setSavedConfigs(addSavedConfig(store.config, "draft"));
    toast({ title: t("mocks.saved.savedToast", { defaultValue: "Config sauvegardée" }) });
  }

  function handleDownloadSaved(entry: SavedMockConfig) {
    const safeName = entry.name.replace(/[^a-z0-9._-]+/gi, "-").toLowerCase();
    downloadMockConfig(entry.config, `${safeName || "mock.config"}.json`);
  }

  function scheduleLayoutSave(patch: MocksLayout) {
    layoutRef.current = { ...layoutRef.current, ...patch };
    if (layoutTimerRef.current !== null) window.clearTimeout(layoutTimerRef.current);
    layoutTimerRef.current = window.setTimeout(() => {
      saveMocksLayout(layoutRef.current);
      layoutTimerRef.current = null;
    }, LAYOUT_SAVE_DEBOUNCE_MS);
  }

  function toggleLogsCollapsed() {
    const next = !logsCollapsed;
    setLogsCollapsed(next);
    if (next) logsPanelRef.current?.collapse();
    else logsPanelRef.current?.expand();
    scheduleLayoutSave({ logsCollapsed: next });
  }

  function handleOuterLayout(sizes: number[]) {
    if (sizes.length >= 2 && !logsCollapsed) {
      scheduleLayoutSave({ logs: Math.round(sizes[1]) });
    }
  }

  function handleInnerLayout(sizes: number[]) {
    if (typeof sizes[0] === "number") scheduleLayoutSave({ left: Math.round(sizes[0]) });
  }

  async function handleCopyCmd() {
    try {
      await navigator.clipboard.writeText(COPY_CMD);
      toast({ title: t(K.copiedCmd, { defaultValue: "Commande copiée" }) });
    } catch {
      toast({
        title: t(K.copyFailed, { defaultValue: "Copie impossible" }),
        description: COPY_CMD,
        variant: "destructive",
      });
    }
  }

  /** Connexion réussie = le brouillon est considéré comme appliqué à cet instant. */
  async function handleConnect(base: string, token: string): Promise<boolean> {
    const ok = await admin.handleConnect(base, token);
    if (ok && store.config) setAppliedSnapshot(configSnapshot(store.config));
    toast({ title: ok ? "Mock connecté" : "Échec connexion", variant: ok ? "default" : "destructive" });
    return ok;
  }

  async function handleApply(): Promise<void> {
    const ok = await admin.handleApply();
    if (ok && store.config) setAppliedSnapshot(configSnapshot(store.config));
    toast({ title: ok ? "Mock appliqué" : "Échec apply", variant: ok ? "default" : "destructive" });
  }

  const routes = store.routes;
  const selectedRoute = store.selectedRoute;
  const attached = admin.attach.status === "connected";
  const showOfflineBanner =
    admin.attach.status === "offline" && !admin.connectOpen && !!store.config;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MockStatusBar
        attach={admin.attach}
        settings={admin.settings}
        connectOpen={admin.connectOpen}
        onConnectOpenChange={admin.setConnectOpen}
        pollingActive={admin.pollingActive}
        onTogglePolling={admin.togglePolling}
        onConnect={(base, token) => handleConnect(base, token)}
        onDisconnect={admin.handleDisconnect}
        onReset={() => setResetOpen(true)}
      />

      {showOfflineBanner && (
        <div className="border-warning/30 bg-warning/5 text-warning mx-4 mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-xs">
          <Terminal aria-hidden="true" className="size-3.5 shrink-0" />
          <span>
            {t(K.offlineBanner, { defaultValue: "Aucun mock détecté — lance" })}{" "}
            <code className="bg-background/60 rounded border px-1 py-px font-mono">
              recli mock start
            </code>
            {(store.config?.port ?? null) != null && (
              <span className="text-muted-foreground"> (port {store.config?.port})</span>
            )}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-2 text-[11px]"
            onClick={() => void handleCopyCmd()}
          >
            <Copy aria-hidden="true" className="size-3" />
            {t("mocks.actions.copyCmd", { defaultValue: "Copier commande CLI" })}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto h-6 gap-1 px-2 text-[11px]"
            onClick={() => admin.setConnectOpen(true)}
          >
            <PlugZap aria-hidden="true" className="size-3" />
            {t(K.offlineOpenForm, { defaultValue: "Connecter un mock" })}
          </Button>
        </div>
      )}

      <PageToolbar
        className="shrink-0 px-4 pt-3"
        draftSavedAt={store.draftSavedAt}
        canExport={!!store.config}
        canApply={attached && !!store.config && !!admin.settings}
        applyDirty={draftDirty && attached}
        simpleMode={simpleMode}
        onSimpleModeChange={handleSimpleModeChange}
        onNewRoute={store.addRoute}
        onGenerate={() => setGenerateOpen(true)}
        onImportFile={(file) => void store.handleImportFile(file)}
        onExport={() => (store.config ? downloadMockConfig(store.config) : null)}
        onCopyCmd={() => void handleCopyCmd()}
        onApply={() => void handleApply()}
      />

      {!store.config ? (
        <div className="text-muted-foreground m-4 flex flex-1 items-center justify-center rounded-xl border border-dashed p-10 text-sm">
          <Loader2 aria-hidden="true" className="size-5 animate-spin opacity-60" />
        </div>
      ) : simpleMode ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 md:flex-row md:overflow-hidden">
          <SimpleModePanel
            className="min-h-0 flex-1"
            onRequestReplace={store.requestReplace}
            onGenerated={handleConfigGenerated}
          />
          <SavedConfigsPanel
            className="shrink-0 md:w-72"
            configs={savedConfigs}
            canSaveCurrentDraft={!!store.config}
            onSaveCurrentDraft={handleSaveCurrentDraft}
            onLoad={(config) => store.requestReplace(config)}
            onDownload={handleDownloadSaved}
            onRemove={(id) => setSavedConfigs(removeSavedConfig(id))}
          />
        </div>
      ) : routes.length === 0 ? (
        <EmptyState onAddRoute={store.addRoute} />
      ) : (
        <MocksWorkspace
          isMobile={isMobile}
          routeList={
            <RouteList
              routes={routes}
              selectedId={selectedRoute?.id ?? null}
              selectedIds={store.selectedIds}
              onRowClick={store.handleRowClick}
              onToggleSelected={store.toggleSelected}
              onClearSelection={store.clearSelection}
              onDelete={(id) => store.requestDelete([id])}
              onDuplicate={store.duplicateRouteById}
              onToggleEnabled={store.toggleRouteEnabled}
              onDuplicateSelected={store.duplicateSelected}
              onSetEnabledSelected={store.setEnabledSelected}
              onDeleteSelected={store.deleteSelected}
            />
          }
          editorPane={
            selectedRoute ? (
              <RouteEditor
                key={selectedRoute.id}
                route={selectedRoute}
                onChange={(patch) => store.patchRoute(selectedRoute.id, patch)}
                onDuplicate={() => store.duplicateRouteById(selectedRoute.id)}
                onDelete={() => store.requestDelete([selectedRoute.id])}
              />
            ) : null
          }
          logsPane={
            <MockLogs
              settings={admin.settings}
              attached={attached}
              pollingActive={admin.pollingActive}
              collapsed={logsCollapsed}
              onToggleCollapsed={isMobile ? undefined : toggleLogsCollapsed}
            />
          }
          leftPanelRef={leftPanelRef}
          logsPanelRef={logsPanelRef}
          logsCollapsed={logsCollapsed}
          onToggleLogsCollapsed={toggleLogsCollapsed}
          onLogsCollapse={() => {
            setLogsCollapsed(true);
            scheduleLayoutSave({ logsCollapsed: true });
          }}
          onLogsExpand={() => {
            setLogsCollapsed(false);
            scheduleLayoutSave({ logsCollapsed: false });
          }}
          onInnerLayout={handleInnerLayout}
          onOuterLayout={handleOuterLayout}
        />
      )}

      <MocksDialogs
        generateOpen={generateOpen}
        onGenerateOpenChange={setGenerateOpen}
        config={store.config}
        requestReplace={store.requestReplace}
        pendingReplace={store.pendingReplace}
        onPendingReplaceOpenChange={(open) => {
          if (!open) store.setPendingReplace(null);
        }}
        onDoReplace={store.doReplace}
        resetOpen={resetOpen}
        onResetOpenChange={setResetOpen}
        onReset={() => void admin.handleReset()}
        deleteTarget={store.deleteTarget}
        deleteTargetDescription={
          store.deleteTargetRoutes
            ? `${String(store.deleteTargetRoutes.method).toUpperCase()} ${store.deleteTargetRoutes.path}`
            : null
        }
        onDeleteDialogOpenChange={(open) => {
          if (!open) store.requestDeleteDismiss();
        }}
        onConfirmDelete={store.confirmDelete}
      />
    </div>
  );
}

/** Empty state quand la config n'a aucune route. */
function EmptyState({ onAddRoute }: { onAddRoute: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="text-muted-foreground m-4 flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-10 text-center">
      <Boxes aria-hidden="true" className="size-10 opacity-40" />
      <p className="text-foreground text-sm font-medium">
        {t(K.emptyTitle, { defaultValue: "Aucune route dans cette config" })}
      </p>
      <p className="max-w-sm text-xs">
        {t(K.emptyDesc, {
          defaultValue:
            "Crée une route manuellement ou génère une config complète depuis tes collections Reqly.",
        })}
      </p>
      <Button size="sm" className="mt-2 gap-1.5" onClick={onAddRoute}>
        <Plus aria-hidden="true" className="size-4" />
        {t(K.newRoute, { defaultValue: "Nouvelle route" })}
      </Button>
    </div>
  );
}

/** useIsMobile sans import cyclable : matchMedia simple. */
function useIsMobileSafe(): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return mobile;
}

export default MockPage;

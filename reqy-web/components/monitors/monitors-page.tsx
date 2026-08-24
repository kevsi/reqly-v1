"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Clock,
  FileDown,
  History,
  Pencil,
  Play,
  Plus,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { useRequestStore } from "@/hooks/use-request-store";
import { toast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import type { Collection, SavedProject } from "@/lib/types";
import {
  MONITOR_INTERVALS,
  type Monitor,
  type MonitorHttpRequest,
  type MonitorInterval,
  type MonitorRunRecord,
} from "@/lib/monitors/types";
import { useMonitors } from "@/hooks/use-monitors";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const K = {
  title: "monitors.title",
  subtitle: "monitors.subtitle",
  newMonitor: "monitors.new",
  generate: "monitors.generate",
  runNow: "monitors.runNow",
  emptyTitle: "monitors.empty.title",
  emptyDesc: "monitors.empty.description",
  requestsCount: "monitors.requestsCount",
  intervalLabel: "monitors.interval",
  expectedStatus: "monitors.expectedStatus",
  latencyThreshold: "monitors.latencyThreshold",
  latencyHint: "monitors.latencyHint",
  webhook: "monitors.webhook",
  webhookHint: "monitors.webhookHint",
  name: "monitors.name",
  editTitle: "monitors.editTitle",
  createTitle: "monitors.createTitle",
  save: "common.save",
  cancel: "common.cancel",
  historyTitle: "monitors.history.title",
  historyEmpty: "monitors.history.empty",
  lastRun: "monitors.lastRun",
  nextRun: "monitors.nextRun",
  never: "monitors.never",
  statusPass: "monitors.status.pass",
  statusFail: "monitors.status.fail",
  statusDegraded: "monitors.status.degraded",
  statusNever: "monitors.status.never",
  deleteTitle: "monitors.deleteTitle",
  generatedToast: "monitors.generatedToast",
  runningToast: "monitors.runningToast",
  pausedBadge: "monitors.paused",
  pickCollection: "monitors.pickCollection",
  pickedRequests: "monitors.pickedRequests",
} as const;

const INTERVAL_LABELS: Record<MonitorInterval, string> = {
  300: "5 min",
  900: "15 min",
  1800: "30 min",
  3600: "1 h",
  86400: "24 h",
};

interface PickedRequest {
  id: string;
  name: string;
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
}

type EditorState =
  | null
  | {
      mode: "create" | "edit";
      id?: string;
      name: string;
      intervalSec: MonitorInterval;
      expectedStatus: number;
      latencyThresholdMs: string;
      webhookUrl: string;
      headerChecks: Array<{ name: string; contains: string }>;
      bodyContains: string;
      bodyJsonPath: string;
      collectionId: string | null;
      requestIds: Set<string>;
      /** Snapshots existants (mode édition) — fallback si la collection source a disparu. */
      existingRequests?: MonitorHttpRequest[];
    };

function statusTone(status: Monitor["enabled"] extends true ? string : string): string {
  return status === "pass"
    ? "bg-emerald-500"
    : status === "fail"
      ? "bg-red-500"
      : status === "degraded"
        ? "bg-amber-500"
        : "bg-muted-foreground/40";
}

export function MonitorsPage() {
  const { t } = useTranslation();
  const collections = useRequestStore((s) => s.collections);
  const projects = useRequestStore((s) => s.projects);
  const {
    monitors,
    historyByMonitor,
    nextRunAt,
    addMonitor,
    updateMonitor,
    removeMonitor,
    runNow,
    generateFromCollections,
    generateFromScannedProjects,
  } = useMonitors(collections);

  // Horloge 1 s pour les comptes à rebours sans impureté au rendu.
  const [now, setNow] = useState(0);
  useEffect(() => {
    const handle = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(handle);
  }, []);

  const [editor, setEditor] = useState<EditorState>(null);
  const [historyTarget, setHistoryTarget] = useState<Monitor | null>(null);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Monitor | null>(null);

  function openCreate() {
    const firstCollection = collections[0];
    setEditor({
      mode: "create",
      name: "",
      intervalSec: 1800,
      expectedStatus: 200,
      latencyThresholdMs: "",
      webhookUrl: "",
      headerChecks: [],
      bodyContains: "",
      bodyJsonPath: "",
      collectionId: firstCollection?.id ?? null,
      requestIds: new Set(firstCollection?.requests.map((r) => r.id) ?? []),
    });
  }

  function openEdit(monitor: Monitor) {
    setEditor({
      mode: "edit",
      id: monitor.id,
      name: monitor.name,
      intervalSec: monitor.intervalSec,
      expectedStatus: monitor.checks.expectedStatus,
      latencyThresholdMs: monitor.checks.latencyThresholdMs
        ? String(monitor.checks.latencyThresholdMs)
        : "",
      webhookUrl: monitor.webhookUrl ?? "",
      headerChecks: (monitor.checks.headers ?? []).map((h) => ({
        name: h.name,
        contains: h.contains ?? "",
      })),
      bodyContains: monitor.checks.bodyContains ?? "",
      bodyJsonPath: monitor.checks.bodyJsonPath ?? "",
      collectionId: null,
      requestIds: new Set(monitor.requests.map((r) => r.id)),
      existingRequests: monitor.requests,
    });
  }

  return (
    <main className="flex flex-1 flex-col overflow-hidden" data-testid="monitors-page">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Activity aria-hidden="true" className="text-primary size-5" />
            {t(K.title, { defaultValue: "Monitors" })}
          </h1>
          <p className="text-muted-foreground text-xs">
            {t(K.subtitle, {
              defaultValue:
                "Rejoue tes collections à intervalle régulier tant que l'app est ouverte. Alertes webhook sur échec, dégradation et rétablissement.",
            })}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setGenerateOpen(true)}>
            <Wand2 aria-hidden="true" className="size-3.5" />
            {t(K.generate, { defaultValue: "Générer depuis collections" })}
          </Button>
          <Button type="button" size="sm" className="h-8 gap-1.5 text-xs" onClick={openCreate}>
            <Plus aria-hidden="true" className="size-3.5" />
            {t(K.newMonitor, { defaultValue: "Nouveau monitor" })}
          </Button>
        </div>
      </div>

      <div className="scrollbar-discreet flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-4">
        {monitors.length === 0 ? (
          <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-10 text-center">
            <Activity aria-hidden="true" className="size-10 opacity-40" />
            <p className="text-foreground text-sm font-medium">
              {t(K.emptyTitle, { defaultValue: "Aucun monitor" })}
            </p>
            <p className="max-w-md text-xs">{t(K.emptyDesc, { defaultValue: "Crée un monitor ou génère-les automatiquement depuis tes collections." })}</p>
          </div>
        ) : (
          monitors.map((monitor) => (
            <MonitorCard
              key={monitor.id}
              monitor={monitor}
              now={now}
              lastRun={historyByMonitor.get(monitor.id)?.[0]}
              nextRunAt={nextRunAt[monitor.id]}
              onToggle={(enabled) => updateMonitor(monitor.id, { enabled })}
              onRun={() => void runNow(monitor.id)}
              onEdit={() => openEdit(monitor)}
              onDelete={() => setDeleteTarget(monitor)}
              onHistory={() => setHistoryTarget(monitor)}
            />
          ))
        )}
      </div>

      {editor && (
        <MonitorEditorDialog
          editor={editor}
          collections={collections}
          onClose={() => setEditor(null)}
          onSubmit={(data) => {
            if (editor.mode === "create") {
              addMonitor(data);
            } else if (editor.id) {
              updateMonitor(editor.id, data);
            }
            setEditor(null);
          }}
        />
      )}

      <GenerateMonitorsDialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        onConfirmCollections={(ids, intervalSec, checks, webhookUrl) => {
          const created = generateFromCollections(ids, intervalSec, checks, webhookUrl);
          toast({
            title: t(K.generatedToast, {
              defaultValue: "{{count}} monitor(s) créé(s)",
              count: created,
            }),
          });
        }}
        onConfirmProjects={(payload) => {
          const created = generateFromScannedProjects(
            payload.projects,
            (projectId) => {
              const project = projects.find((p) => p.id === projectId);
              if (!project) return [];
              return project.routes.map((route) => ({
                id: `${project.id}-${String(route.method).toLowerCase()}-${route.path}`,
                name: route.name || route.path,
                method: String(route.method),
                url: `${(payload.baseUrlByProject[project.id] ?? "").replace(/\/+$/, "")}${route.path}`,
              }));
            },
            payload.baseUrlByProject,
            payload.intervalSec,
            payload.checks,
            payload.webhookUrl,
          );
          toast({
            title: t(K.generatedToast, {
              defaultValue: "{{count}} monitor(s) créé(s)",
              count: created,
            }),
          });
        }}
        projects={projects}
      />

      <Dialog open={!!historyTarget} onOpenChange={(open) => !open && setHistoryTarget(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {t(K.historyTitle, { defaultValue: "Historique — {{name}}", name: historyTarget?.name ?? "" })}
              {historyTarget && (historyByMonitor.get(historyTarget.id)?.length ?? 0) > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  onClick={() => {
                    const records = historyByMonitor.get(historyTarget.id) ?? [];
                    const blob = new Blob([JSON.stringify(records, null, 2)], {
                      type: "application/json",
                    });
                    const url = URL.createObjectURL(blob);
                    const anchor = document.createElement("a");
                    anchor.href = url;
                    const safeName = historyTarget.name.replace(/[^a-z0-9._-]+/gi, "-").toLowerCase();
                    anchor.download = `monitor-${safeName || "history"}-historique.json`;
                    anchor.click();
                    URL.revokeObjectURL(url);
                  }}
                  aria-label={t("monitors.history.export", { defaultValue: "Exporter l'historique (JSON)" })}
                  title={t("monitors.history.export", { defaultValue: "Exporter l'historique (JSON)" })}
                >
                  <FileDown aria-hidden="true" className="size-3.5" />
                </Button>
              )}
            </DialogTitle>
          </DialogHeader>
          <HistoryList records={historyTarget ? (historyByMonitor.get(historyTarget.id) ?? []) : []} />
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t(K.deleteTitle, { defaultValue: "Supprimer ce monitor ?" })}
        description={deleteTarget?.name ?? ""}
        confirmLabel={t("mocks.bulk.remove", { defaultValue: "Supprimer" })}
        onConfirm={() => {
          if (deleteTarget) removeMonitor(deleteTarget.id);
          setDeleteTarget(null);
        }}
      />
    </main>
  );
}

// ── Carte monitor ─────────────────────────────────────────────────────────

function MonitorCard({
  monitor,
  now,
  lastRun,
  nextRunAt,
  onToggle,
  onRun,
  onEdit,
  onDelete,
  onHistory,
}: {
  monitor: Monitor;
  now: number;
  lastRun?: MonitorRunRecord;
  nextRunAt?: number;
  onToggle: (enabled: boolean) => void;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onHistory: () => void;
}) {
  const { t } = useTranslation();
  const lastStatus = lastRun?.status ?? "never";
  return (
    <div className="bg-card flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2.5">
      <span
        aria-hidden="true"
        className={cn("size-2 shrink-0 rounded-full", statusTone(lastStatus))}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{monitor.name}</p>
        <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-[11px]">
          <span>{t(K.requestsCount, { defaultValue: "{{count}} requêtes", count: monitor.requests.length })}</span>
          <span aria-hidden="true">·</span>
          <Clock aria-hidden="true" className="inline size-3" />
          <span>{INTERVAL_LABELS[monitor.intervalSec] ?? `${monitor.intervalSec}s`}</span>
          <span aria-hidden="true">·</span>
          <span>
            {t(K.lastRun, { defaultValue: "Dernier" })}:{" "}
            {lastRun ? new Date(lastRun.at).toLocaleTimeString() : t(K.never, { defaultValue: "jamais" })}
          </span>
          {monitor.enabled && nextRunAt != null && now > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span>
                {t(K.nextRun, { defaultValue: "Prochain dans" })}{" "}
                {formatCountdown(nextRunAt - now)}
              </span>
            </>
          )}
        </p>
      </div>
      {!monitor.enabled && (
        <Badge variant="outline" className="shrink-0 text-[10px]">
          {t(K.pausedBadge, { defaultValue: "En pause" })}
        </Badge>
      )}
      <Switch checked={monitor.enabled} onCheckedChange={onToggle} aria-label={monitor.name} />
      <div className="flex shrink-0 items-center gap-0.5">
        <Button type="button" variant="ghost" size="icon" className="size-7" onClick={onRun} aria-label={t(K.runNow, { defaultValue: "Exécuter maintenant" })} title={t(K.runNow, { defaultValue: "Exécuter maintenant" })}>
          <Play aria-hidden="true" className="size-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="size-7" onClick={onHistory} aria-label={t(K.historyTitle, { defaultValue: "Historique" })} title={t(K.historyTitle, { defaultValue: "Historique" })}>
          <History aria-hidden="true" className="size-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="size-7" onClick={onEdit} aria-label={t("common.edit", { defaultValue: "Modifier" })} title={t("common.edit", { defaultValue: "Modifier" })}>
          <Pencil aria-hidden="true" className="size-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="hover:text-destructive size-7 text-destructive" onClick={onDelete} aria-label={t("mocks.bulk.remove", { defaultValue: "Supprimer" })} title={t("mocks.bulk.remove", { defaultValue: "Supprimer" })}>
          <Trash2 aria-hidden="true" className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

function formatCountdown(ms: number): string {
  const clamped = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  if (m >= 60) return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ── Historique ────────────────────────────────────────────────────────────

function HistoryList({ records }: { records: MonitorRunRecord[] }) {
  const { t } = useTranslation();
  if (records.length === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        {t(K.historyEmpty, { defaultValue: "Aucune exécution pour le moment." })}
      </p>
    );
  }
  return (
    <ul className="max-h-[50vh] flex flex-col gap-1 overflow-y-auto p-1 scrollbar-discreet">
      {records.slice(0, 50).map((record) => (
        <li key={record.id} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs">
          <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", statusTone(record.status))} />
          <span className="font-mono tabular-nums">{new Date(record.at).toLocaleTimeString()}</span>
          <Badge
            variant="outline"
            className={cn(
              "shrink-0 px-1 text-[9px] uppercase",
              record.status === "pass" && "border-emerald-500/40 text-emerald-600",
              record.status === "fail" && "border-red-500/40 text-red-600",
              record.status === "degraded" && "border-amber-500/40 text-amber-600",
            )}
          >
            {record.status}
          </Badge>
          <span className="text-muted-foreground ml-auto shrink-0 font-mono tabular-nums">
            {record.durationMs} ms
          </span>
          <span className="text-muted-foreground shrink-0 font-mono tabular-nums">
            {record.checks.filter((c) => c.ok).length}/{record.checks.length}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ── Éditeur ───────────────────────────────────────────────────────────────

function MonitorEditorDialog({
  editor,
  collections,
  onClose,
  onSubmit,
}: {
  editor: NonNullable<EditorState>;
  collections: Collection[];
  onClose: () => void;
  onSubmit: (data: Omit<Monitor, "id" | "createdAt" | "updatedAt">) => void;
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<NonNullable<EditorState>>(editor);
  const selectedCollection = collections.find((c) => c.id === state.collectionId) ?? null;

  const pickedRequests = useMemo<PickedRequest[]>(() => {
    // Mode création : snapshot live de la collection choisie.
    if (state.mode === "create" && selectedCollection) {
      return selectedCollection.requests
        .filter((r) => state.requestIds.has(r.id))
        .map((r) => ({
          id: r.id,
          name: r.name,
          method: String(r.method),
          url: r.url || r.endpoint,
        }));
    }
    // Mode édition : résolution live d'abord, fallback sur les snapshots.
    const live = new Map(
      collections.flatMap((c) => c.requests).map((r) => [r.id, r]),
    );
    return [...state.requestIds]
      .map((id): PickedRequest | null => {
        const item = live.get(id);
        if (item) {
          return {
            id: item.id,
            name: item.name,
            method: String(item.method),
            url: item.url || item.endpoint,
            headers: (item.headers ?? undefined) as Record<string, string> | undefined,
            body: item.body,
          };
        }
        const snapshot = state.existingRequests?.find((r) => r.id === id);
        if (snapshot) {
          return {
            id: snapshot.id,
            name: snapshot.name,
            method: snapshot.method,
            url: snapshot.url,
            headers: snapshot.headers,
            body: snapshot.body,
          };
        }
        return null;
      })
      .filter((r): r is PickedRequest => !!r);
  }, [state.mode, state.requestIds, state.existingRequests, selectedCollection, collections]);

  function toggleRequest(id: string) {
    setState((prev) => {
      const requestIds = new Set(prev.requestIds);
      if (requestIds.has(id)) requestIds.delete(id);
      else requestIds.add(id);
      return { ...prev, requestIds };
    });
  }

  function submit() {
    if (!state.name.trim()) return;
    const threshold = Number.parseInt(state.latencyThresholdMs, 10);
    const headerChecks = state.headerChecks
      .filter((h) => h.name.trim().length > 0)
      .map((h) => ({
        name: h.name.trim(),
        ...(h.contains.trim() ? { contains: h.contains.trim() } : {}),
      }));
    onSubmit({
      name: state.name.trim(),
      enabled: true,
      intervalSec: state.intervalSec,
      checks: {
        expectedStatus: Number.isFinite(state.expectedStatus) ? state.expectedStatus : 200,
        ...(Number.isFinite(threshold) && threshold > 0 ? { latencyThresholdMs: threshold } : {}),
        ...(headerChecks.length > 0 ? { headers: headerChecks } : {}),
        ...(state.bodyContains.trim() ? { bodyContains: state.bodyContains.trim() } : {}),
        ...(state.bodyJsonPath.trim() ? { bodyJsonPath: state.bodyJsonPath.trim() } : {}),
      },
      ...(state.webhookUrl.trim() ? { webhookUrl: state.webhookUrl.trim() } : {}),
      requests: pickedRequests.map((r) => ({
        id: r.id,
        name: r.name,
        method: r.method,
        url: r.url,
        headers: r.headers,
        body: r.body,
      })),
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {state.mode === "create"
              ? t(K.createTitle, { defaultValue: "Nouveau monitor" })
              : t(K.editTitle, { defaultValue: "Modifier le monitor" })}
          </DialogTitle>
          <DialogDescription>
            {t(K.subtitle, { defaultValue: "" })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="mon-name" className="text-muted-foreground text-xs">{t(K.name, { defaultValue: "Nom" })}</Label>
            <Input id="mon-name" value={state.name} onChange={(e) => setState((p) => ({ ...p, name: e.target.value }))} placeholder="API production" className="h-8 text-sm" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label className="text-muted-foreground text-xs">{t(K.intervalLabel, { defaultValue: "Intervalle" })}</Label>
              <Select value={String(state.intervalSec)} onValueChange={(v) => setState((p) => ({ ...p, intervalSec: Number(v) as MonitorInterval }))}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MONITOR_INTERVALS.map((sec) => (
                    <SelectItem key={sec} value={String(sec)}>{INTERVAL_LABELS[sec]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="mon-status" className="text-muted-foreground text-xs">{t(K.expectedStatus, { defaultValue: "Statut attendu" })}</Label>
              <Input id="mon-status" type="number" value={state.expectedStatus} onChange={(e) => setState((p) => ({ ...p, expectedStatus: e.target.valueAsNumber }))} className="h-8 font-mono text-sm" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="mon-latency" className="text-muted-foreground text-xs">{t(K.latencyThreshold, { defaultValue: "Seuil latence (ms)" })}</Label>
              <Input id="mon-latency" type="number" min={0} value={state.latencyThresholdMs} onChange={(e) => setState((p) => ({ ...p, latencyThresholdMs: e.target.value }))} placeholder="1000" className="h-8 font-mono text-sm" />
              <p className="text-muted-foreground text-[10px]">{t(K.latencyHint, { defaultValue: "Optionnel — au-delà, l'exécution passe en « dégradé »." })}</p>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="mon-webhook" className="text-muted-foreground text-xs">{t(K.webhook, { defaultValue: "Webhook d'alerte" })}</Label>
              <Input id="mon-webhook" value={state.webhookUrl} onChange={(e) => setState((p) => ({ ...p, webhookUrl: e.target.value }))} placeholder="https://hooks.ex.com/…" className={cn("h-8 font-mono text-xs", state.webhookUrl.startsWith("http://") && "border-warning/60")} spellCheck={false} autoComplete="off" />
              <p className="text-muted-foreground text-[10px]">{t(K.webhookHint, { defaultValue: "POST JSON sur transition échec/dégradé/rétabli." })}</p>
              {state.webhookUrl.startsWith("http://") && (
                <p role="alert" className="text-[10px] text-amber-600 dark:text-amber-400">
                  {t("monitors.webhookHttpWarning", { defaultValue: "Webhook en http:// : le payload transite en clair. Préfère https://" })}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1.5 rounded-md border p-2">
            <p className="text-muted-foreground text-[11px] font-medium">
              {t("monitors.advancedChecks", { defaultValue: "Vérifications avancées (par requête)" })}
            </p>

            <Label className="text-muted-foreground text-[11px]">{t("monitors.headerChecks", { defaultValue: "Headers requis" })}</Label>
            {state.headerChecks.map((headerCheck, index) => (
              <div key={index} className="flex items-center gap-1.5">
                <Input
                  value={headerCheck.name}
                  onChange={(e) =>
                    setState((p) => ({
                      ...p,
                      headerChecks: p.headerChecks.map((h, i) => (i === index ? { ...h, name: e.target.value } : h)),
                    }))
                  }
                  placeholder="x-request-id"
                  className="h-7 flex-1 font-mono text-[11px]"
                  aria-label={t("monitors.headerName", { defaultValue: "Nom du header" })}
                />
                <Input
                  value={headerCheck.contains}
                  onChange={(e) =>
                    setState((p) => ({
                      ...p,
                      headerChecks: p.headerChecks.map((h, i) => (i === index ? { ...h, contains: e.target.value } : h)),
                    }))
                  }
                  placeholder={t("monitors.headerContains", { defaultValue: "contient (optionnel)" })}
                  className="h-7 flex-1 text-[11px]"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="hover:text-destructive size-6 shrink-0 text-destructive"
                  onClick={() => setState((p) => ({ ...p, headerChecks: p.headerChecks.filter((_, i) => i !== index) }))}
                  aria-label={t("common.remove", { defaultValue: "Retirer" })}
                >
                  <X aria-hidden="true" className="size-3" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 w-fit px-2 text-[10px]"
              onClick={() => setState((p) => ({ ...p, headerChecks: [...p.headerChecks, { name: "", contains: "" }] }))}
            >
              + {t("monitors.addHeader", { defaultValue: "Ajouter un header" })}
            </Button>

            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-0.5">
                <Label htmlFor="mon-bodycontains" className="text-muted-foreground text-[11px]">{t("monitors.bodyContains", { defaultValue: "Le corps contient…" })}</Label>
                <Input id="mon-bodycontains" value={state.bodyContains} onChange={(e) => setState((p) => ({ ...p, bodyContains: e.target.value }))} className="h-7 text-[11px]" />
              </div>
              <div className="flex flex-col gap-0.5">
                <Label htmlFor="mon-jsonpath" className="text-muted-foreground text-[11px]">{t("monitors.bodyJsonPath", { defaultValue: "JSON-path requis" })}</Label>
                <Input id="mon-jsonpath" value={state.bodyJsonPath} onChange={(e) => setState((p) => ({ ...p, bodyJsonPath: e.target.value }))} placeholder="data.items.0.id" className="h-7 font-mono text-[11px]" spellCheck={false} />
              </div>
            </div>
          </div>

          {state.mode === "create" && (
            <div className="flex flex-col gap-1">
              <Label className="text-muted-foreground text-xs">{t(K.pickCollection, { defaultValue: "Collection surveillée" })}</Label>
              <Select
                value={state.collectionId ?? undefined}
                onValueChange={(v) =>
                  setState((p) => ({
                    ...p,
                    collectionId: v,
                    requestIds: new Set(collections.find((c) => c.id === v)?.requests.map((r) => r.id) ?? []),
                  }))
                }
              >
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder={t(K.pickCollection, { defaultValue: "Collection" })} /></SelectTrigger>
                <SelectContent>
                  {collections.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {state.mode === "create" && selectedCollection && (
            <div className="max-h-44 overflow-y-auto rounded-md border p-1.5 scrollbar-discreet">
              <ul className="flex flex-col gap-0.5">
                {selectedCollection.requests.map((request) => (
                  <li key={request.id}>
                    <label className={cn("flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 hover:bg-accent/50", state.requestIds.has(request.id) && "bg-primary/10")}>
                      <input type="checkbox" checked={state.requestIds.has(request.id)} onChange={() => toggleRequest(request.id)} className="accent-primary" aria-label={request.name} />
                      <Badge variant="outline" className="shrink-0 px-1 font-mono text-[9px]">{String(request.method).toUpperCase()}</Badge>
                      <span className="min-w-0 truncate font-mono text-[11px]" title={request.url}>{request.url || request.endpoint}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-muted-foreground text-xs">
            {t(K.pickedRequests, { defaultValue: "{{count}} requête(s) surveillée(s).", count: pickedRequests.length })}
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{t(K.cancel, { defaultValue: "Annuler" })}</Button>
          <Button type="button" disabled={!state.name.trim() || pickedRequests.length === 0} onClick={submit}>
            {t(K.save, { defaultValue: "Enregistrer" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Génération depuis collections ─────────────────────────────────────────

function GenerateMonitorsDialog({
  open,
  onOpenChange,
  onConfirmCollections,
  onConfirmProjects,
  projects,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirmCollections: (
    ids: string[],
    intervalSec: Monitor["intervalSec"],
    checks: Monitor["checks"],
    webhookUrl?: string,
  ) => void;
  onConfirmProjects: (payload: {
    projects: Array<{ id: string; name: string; port?: number }>;
    baseUrlByProject: Record<string, string>;
    intervalSec: Monitor["intervalSec"];
    checks: Monitor["checks"];
    webhookUrl?: string;
  }) => void;
  projects: SavedProject[];
}) {
  const { t } = useTranslation();
  const collections = useRequestStore((s) => s.collections);
  const [source, setSource] = useState<"collections" | "projects">("collections");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set());
  const [baseUrlByProject, setBaseUrlByProject] = useState<Record<string, string>>({});
  const [intervalSec, setIntervalSec] = useState<MonitorInterval>(1800);
  const [webhookUrl, setWebhookUrl] = useState("");

  const sorted = useMemo(() => [...collections].sort((a, b) => a.name.localeCompare(b.name)), [collections]);
  const sortedProjects = useMemo(
    () =>
      [...projects]
        .filter((p) => p.routes.length > 0)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [projects],
  );

  function toggle(setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const canSubmit =
    source === "collections"
      ? selected.size > 0
      : [...selectedProjects].every((id) => /^https?:\/\//i.test((baseUrlByProject[id] ?? "").trim())) &&
        selectedProjects.size > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setSelected(new Set());
          setSelectedProjects(new Set());
          setBaseUrlByProject({});
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t(K.generate, { defaultValue: "Générer depuis collections" })}</DialogTitle>
          <DialogDescription>
            {source === "collections"
              ? t("monitors.generateDesc", {
                  defaultValue:
                    "Un monitor par collection sélectionnée, toutes ses requêtes incluses.",
                })
              : t("monitors.generateProjectsDesc", {
                  defaultValue:
                    "Un monitor par projet scanné. Les routes détectées n'ont pas d'hôte : indique la base URL de chaque environnement.",
                })}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="bg-muted/40 flex gap-1 rounded-md p-0.5">
            {(["collections", "projects"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setSource(mode)}
                aria-pressed={source === mode}
                className={cn(
                  "flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
                  source === mode
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {mode === "collections"
                  ? t("monitors.sourceCollections", { defaultValue: "Collections" })
                  : t("monitors.sourceProjects", { defaultValue: "Projets scannés" })}
              </button>
            ))}
          </div>

          {source === "collections" ? (
            <div className="max-h-56 overflow-y-auto rounded-md border p-1.5 scrollbar-discreet">
              {sorted.length === 0 ? (
                <p className="text-muted-foreground p-6 text-center text-sm">—</p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {sorted.map((collection) => (
                    <li key={collection.id}>
                      <label className={cn("flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-accent/50", selected.has(collection.id) && "bg-primary/10")}>
                        <input type="checkbox" checked={selected.has(collection.id)} onChange={() => toggle(setSelected, collection.id)} className="accent-primary" aria-label={collection.name} />
                        <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: collection.color }} />
                        <span className="min-w-0 flex-1 truncate text-sm">{collection.name}</span>
                        <Badge variant="outline" className="font-mono text-[10px]">{collection.requests.length}</Badge>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <div className="max-h-44 overflow-y-auto rounded-md border p-1.5 scrollbar-discreet">
                {sortedProjects.length === 0 ? (
                  <p className="text-muted-foreground p-6 text-center text-sm">
                    {t("monitors.noScannedProjects", { defaultValue: "Aucun projet scanné avec des routes." })}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-0.5">
                    {sortedProjects.map((project) => (
                      <li key={project.id}>
                        <label className={cn("flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-accent/50", selectedProjects.has(project.id) && "bg-primary/10")}>
                          <input type="checkbox" checked={selectedProjects.has(project.id)} onChange={() => toggle(setSelectedProjects, project.id)} className="accent-primary" aria-label={project.name} />
                          <span className="min-w-0 flex-1 truncate text-sm">{project.name}</span>
                          <Badge variant="outline" className="font-mono text-[10px]">{project.routes.length} routes</Badge>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {[...selectedProjects].map((projectId) => {
                const project = projects.find((p) => p.id === projectId);
                return (
                  <div key={projectId} className="flex flex-col gap-0.5">
                    <Label className="text-muted-foreground text-[11px]">
                      {t("monitors.baseUrlFor", { defaultValue: "Base URL — {{name}}", name: project?.name ?? projectId })}
                    </Label>
                    <Input
                      value={baseUrlByProject[projectId] ?? ""}
                      onChange={(e) => setBaseUrlByProject((prev) => ({ ...prev, [projectId]: e.target.value }))}
                      placeholder={(project?.port ? `http://localhost:${project.port}` : "https://api.exemple.com")}
                      className={cn("h-7 font-mono text-[11px]", (baseUrlByProject[projectId] ?? "") !== "" && !/^https?:\/\//i.test(baseUrlByProject[projectId].trim()) && "border-destructive")}
                      spellCheck={false}
                    />
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex items-center gap-3">
            <Label className="text-muted-foreground shrink-0 text-xs">{t(K.intervalLabel, { defaultValue: "Intervalle" })}</Label>
            <Select value={String(intervalSec)} onValueChange={(v) => setIntervalSec(Number(v) as MonitorInterval)}>
              <SelectTrigger className="h-8 w-28 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONITOR_INTERVALS.map((sec) => (
                  <SelectItem key={sec} value={String(sec)}>{INTERVAL_LABELS[sec]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="gen-webhook" className="text-muted-foreground text-xs">{t(K.webhook, { defaultValue: "Webhook d'alerte" })}</Label>
            <Input id="gen-webhook" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://hooks.ex.com/…" className="h-8 font-mono text-xs" spellCheck={false} autoComplete="off" />
            {webhookUrl.startsWith("http://") && (
              <p role="alert" className="text-[10px] text-amber-600 dark:text-amber-400">
                {t("monitors.webhookHttpWarning", { defaultValue: "Webhook en http:// : le payload transite en clair. Préfère https://" })}
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t(K.cancel, { defaultValue: "Annuler" })}</Button>
          <Button
            type="button"
            disabled={!canSubmit}
            onClick={() => {
              if (source === "collections") {
                onConfirmCollections([...selected], intervalSec, { expectedStatus: 200 }, webhookUrl || undefined);
              } else {
                onConfirmProjects({
                  projects: sortedProjects
                    .filter((p) => selectedProjects.has(p.id))
                    .map((p) => ({ id: p.id, name: p.name, port: p.port })),
                  baseUrlByProject: Object.fromEntries(
                    Object.entries(baseUrlByProject).map(([k, v]) => [k, v.trim()]),
                  ),
                  intervalSec,
                  checks: { expectedStatus: 200 },
                  webhookUrl: webhookUrl || undefined,
                });
              }
              setSelected(new Set());
              setSelectedProjects(new Set());
              setBaseUrlByProject({});
              setWebhookUrl("");
              onOpenChange(false);
            }}
          >
            {t(K.generate, { defaultValue: "Générer" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default MonitorsPage;

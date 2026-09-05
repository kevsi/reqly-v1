"use client";

/**
 * Tab Overview — hub d'information de la requête active (lecture-seule +
 * actions rapides). Pattern Postman: la tab « Overview » résume l'état et
 * donne accès direct aux actions fréquentes sans naviguer.
 *
 * Audit UX 2026-09-04: remplace le quick-start retiré; la 1re version était
 * une liste statique — celle-ci est vivante (dates, historique, environnement)
 * et actionnable (exécuter, historique, sauvegarder).
 */

import { useTranslation } from "react-i18next";
import { Clock, Copy, FileText, Folder, History, KeyRound, ListFilter, Play, Save, Zap } from "lucide-react";
import type { RequestTab } from "@/lib/request-executor";
import { useRequestStore } from "@/hooks/use-request-store";
import { getMethodPanelClass } from "@/lib/http-method-colors";
import { cn } from "@/lib/utils";

const K = {
  auth: "overview.auth",
  body: "overview.body",
  queryParams: "overview.queryParams",
  headers: "overview.headers",
  assertions: "overview.assertions",
  saved: "overview.saved",
  notSaved: "overview.notSaved",
  lastStatus: "overview.lastStatus",
  none: "overview.none",
  runs: "overview.runs",
  lastRun: "overview.lastRun",
  neverRun: "overview.neverRun",
  environment: "overview.environment",
  actions: "overview.actions",
  run: "overview.actions.run",
  history: "overview.actions.history",
  save: "overview.actions.save",
  copied: "overview.copied",
  sectionRequest: "overview.sectionRequest",
  sectionOrg: "overview.sectionOrg",
} as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <h3 className="text-muted-foreground border-b border-border px-4 py-2 text-[11px] font-semibold uppercase tracking-wide">
        {title}
      </h3>
      <div className="divide-y divide-border px-4">{children}</div>
    </section>
  );
}

function Row({ icon: Icon, label, children }: {
  icon: typeof KeyRound;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-muted-foreground flex shrink-0 items-center gap-2 text-xs">
        <Icon aria-hidden="true" className="size-3.5" />
        {label}
      </span>
      <span className="min-w-0 truncate text-sm">{children}</span>
    </div>
  );
}

export interface RequestOverviewProps {
  tab: RequestTab;
  onRun: () => void;
  onSave: () => void;
  onOpenHistory: () => void;
}

export function RequestOverview({ tab, onRun, onSave, onOpenHistory }: RequestOverviewProps) {
  const { t } = useTranslation();
  const collections = useRequestStore((s) => s.collections);
  const history = useRequestStore((s) => s.history);
  const environments = useRequestStore((s) => s.environments);
  const activeEnvironmentId = useRequestStore((s) => s.activeEnvironmentId);

  const savedCollection = tab.savedRequestId
    ? collections.find((c) => c.requests.some((r) => r.id === tab.savedRequestId))
    : undefined;

  // Activité: entrées d'historique correspondant à cette requête (id sauvegardé
  // ou signature méthode+url).
  const matchingHistory = history.filter(
    (h) =>
      (tab.savedRequestId && h.id === tab.savedRequestId) ||
      (h.method === tab.method && h.url === tab.url),
  );
  const lastRun = matchingHistory.length > 0
    ? matchingHistory.reduce((a, b) => (a.executedAt > b.executedAt ? a : b))
    : undefined;

  const activeEnv = environments.find((e) => e.id === activeEnvironmentId);

  const copyUrl = () => {
    void navigator.clipboard.writeText(tab.url).catch(() => {
      // clipboard indisponible (permissions/contexte non sécurisé)
    });
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6" data-testid="request-overview">
      {/* En-tête */}
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "rounded-md px-2 py-1 font-mono text-xs font-bold",
            getMethodPanelClass(tab.method),
          )}
        >
          {tab.method}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold">{tab.name}</h2>
          <div className="text-muted-foreground flex items-center gap-1">
            <p className="truncate font-mono text-xs">{tab.url || "—"}</p>
            <button
              type="button"
              onClick={copyUrl}
              aria-label={t(K.copied)}
              title={t(K.copied)}
              className="text-muted-foreground/60 hover:text-foreground shrink-0"
            >
              <Copy aria-hidden="true" className="size-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Actions rapides */}
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t(K.actions)}>
        <button
          type="button"
          onClick={onRun}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90"
        >
          <Play aria-hidden="true" className="size-3.5" />
          {t(K.run)}
        </button>
        <button
          type="button"
          onClick={onSave}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-accent"
        >
          <Save aria-hidden="true" className="size-3.5" />
          {t(K.save)}
        </button>
        <button
          type="button"
          onClick={onOpenHistory}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-accent"
        >
          <History aria-hidden="true" className="size-3.5" />
          {t(K.history)}
        </button>
      </div>

      {/* Requête */}
      <Section title={t(K.sectionRequest)}>
        <Row icon={KeyRound} label={t(K.auth)}>
          {tab.authType === "none"
            ? t(K.none)
            : `${tab.authType}${tab.authToken ? " •••" : ""}`}
        </Row>
        <Row icon={Zap} label={t(K.environment)}>
          {activeEnv?.name ?? t(K.none)}
        </Row>
        <Row icon={ListFilter} label={t(K.queryParams)}>
          {tab.queryParams?.length ?? 0}
        </Row>
        <Row icon={ListFilter} label={t(K.headers)}>
          {tab.headers?.length ?? 0}
        </Row>
        <Row icon={FileText} label={t(K.body)}>
          {tab.body ? `${tab.bodyType ?? "raw"} · ${tab.body.length} chars` : t(K.none)}
        </Row>
      </Section>

      {/* Organisation & activité */}
      <Section title={t(K.sectionOrg)}>
        <Row icon={Folder} label={t(K.saved)}>
          {savedCollection ? savedCollection.name : t(K.notSaved)}
        </Row>
        <Row icon={Zap} label={t(K.assertions)}>
          {tab.runnerAssertions?.length ?? 0}
        </Row>
        <Row icon={History} label={t(K.runs)}>
          {matchingHistory.length}
        </Row>
        <Row icon={Clock} label={t(K.lastRun)}>
          {lastRun
            ? `${t(K.lastStatus)}: ${lastRun.responseStatus ?? "—"} · ${new Date(lastRun.executedAt).toLocaleString()}`
            : t(K.neverRun)}
        </Row>
      </Section>
    </div>
  );
}

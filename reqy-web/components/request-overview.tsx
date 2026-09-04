"use client";

/**
 * Tab Overview — vue lecture-seule des métadonnées de la requête active
 * (audit UX 2026-09-04 : remplacer le quick-start par une tab informative,
 * pattern Postman). Ouverte via la tab « Overview » dans la barre d'onglets.
 */

import { useTranslation } from "react-i18next";
import { KeyRound, Layers, ListFilter, Clock, FileText, Braces } from "lucide-react";
import type { RequestTab } from "@/lib/request-executor";
import { useRequestStore } from "@/hooks/use-request-store";
import { cn } from "@/lib/utils";

const K = {
  title: "overview.title",
  saved: "overview.saved",
  notSaved: "overview.notSaved",
  auth: "overview.auth",
  body: "overview.body",
  queryParams: "overview.queryParams",
  headers: "overview.headers",
  assertions: "overview.assertions",
  lastStatus: "overview.lastStatus",
  updated: "overview.updated",
  none: "overview.none",
} as const;

function Row({ icon: Icon, label, value, mono }: {
  icon: typeof KeyRound;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 py-2">
      <Icon aria-hidden="true" className="text-muted-foreground/60 mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        <p className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">{label}</p>
        <p className={cn("truncate text-sm", mono && "font-mono text-xs")}>{value}</p>
      </div>
    </div>
  );
}

export function RequestOverview({ tab }: { tab: RequestTab }) {
  const { t } = useTranslation();
  const collections = useRequestStore((s) => s.collections);

  const savedCollection = tab.savedRequestId
    ? collections.find((c) => c.requests.some((r) => r.id === tab.savedRequestId))
    : undefined;

  const assertionCount = tab.runnerAssertions?.length ?? 0;

  return (
    <div className="mx-auto max-w-2xl p-6" data-testid="request-overview">
      <div className="mb-5 flex items-center gap-3">
        <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">
          {tab.method}
        </span>
        <h2 className="truncate text-lg font-semibold">{tab.name}</h2>
      </div>

      <div className="divide-y divide-border rounded-lg border border-border bg-card px-4">
        <Row icon={Braces} label="URL" value={tab.url || "—"} mono />
        <Row
          icon={KeyRound}
          label={t(K.auth)}
          value={
            tab.authType === "none"
              ? t(K.none)
              : `${tab.authType}${tab.authToken ? " •••" : ""}`
          }
        />
        <Row icon={FileText} label={t(K.body)} value={tab.body ? `${tab.bodyType} · ${tab.body.length} chars` : t(K.none)} mono />
        <Row icon={ListFilter} label={t(K.queryParams)} value={String(tab.queryParams?.length ?? 0)} />
        <Row icon={Layers} label={t(K.headers)} value={String(tab.headers?.length ?? 0)} />
        <Row icon={Layers} label={t(K.assertions)} value={String(assertionCount)} />
        <Row
          icon={Layers}
          label={t(K.saved)}
          value={savedCollection ? savedCollection.name : t(K.notSaved)}
        />
        {tab.responseStatus !== undefined && (
          <Row
            icon={Clock}
            label={t(K.lastStatus)}
            value={`${tab.responseStatus} · ${tab.responseTime ?? 0} ms`}
            mono
          />
        )}
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown } from "lucide-react";
import type { MockRoute } from "@reqly/mock-engine";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { TransformTester } from "./transform-tester";

const K = {
  title: "mocks.behavior.title",
  latency: "mocks.behavior.latency.title",
  latencyMin: "mocks.behavior.latency.min",
  latencyMax: "mocks.behavior.latency.max",
  latencyHint: "mocks.behavior.latency.hint",
  failure: "mocks.behavior.failure.title",
  failureEnable: "mocks.behavior.failure.enable",
  failureProbability: "mocks.behavior.failure.probability",
  failureKind: "mocks.behavior.failure.kind",
  kindStatus: "mocks.behavior.failure.kindStatus",
  kindTimeout: "mocks.behavior.failure.kindTimeout",
  kindReset: "mocks.behavior.failure.kindReset",
  kindMalformed: "mocks.behavior.failure.kindMalformed",
  failureStatusCode: "mocks.behavior.failure.statusCode",
  failureTimeoutMs: "mocks.behavior.failure.timeoutMs",
  stateful: "mocks.behavior.stateful.title",
  statefulEnable: "mocks.behavior.stateful.enable",
  statefulResource: "mocks.behavior.stateful.resource",
  statefulResourcePh: "mocks.behavior.stateful.resourcePlaceholder",
  statefulIdField: "mocks.behavior.stateful.idField",
  transform: "mocks.behavior.transform.title",
  transformWarning: "mocks.behavior.transform.warning",
} as const;

interface BehaviorSectionProps {
  route: MockRoute;
  onChange: (patch: Partial<MockRoute>) => void;
}

/** Fixed-width numeric field with a unit suffix (ms / %). */
function NumberUnitField({
  id,
  label,
  value,
  suffix,
  width,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  suffix: string;
  width: string;
  min?: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className={cn("flex flex-col gap-1", width)}>
      <Label htmlFor={id} className="text-muted-foreground text-xs">
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          type="number"
          min={0}
          value={value}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
          className="h-8 pr-7 font-mono tabular-nums"
        />
        <span
          aria-hidden="true"
          className="text-muted-foreground pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 font-mono text-[10px]"
        >
          {suffix}
        </span>
      </div>
    </div>
  );
}

export function BehaviorSection({ route, onChange }: BehaviorSectionProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const latency = route.latency;
  const failure = route.failure;
  const stateful = route.stateful;

  function setLatency(patch: Partial<NonNullable<MockRoute["latency"]>>) {
    const base = latency ?? { minMs: 0, maxMs: 0 };
    onChange({
      latency: {
        ...base,
        ...patch,
      },
    });
  }

  function setFailure(patch: Partial<NonNullable<MockRoute["failure"]>>) {
    const base = failure ?? { probability: 0, kind: "status" as const };
    const next = { ...base, ...patch };
    onChange({ failure: next.probability > 0 ? next : undefined });
  }

  function setStateful(patch: Partial<NonNullable<MockRoute["stateful"]>>) {
    const base = stateful ?? { enabled: true };
    const next = { ...base, ...patch };
    onChange({ stateful: next.enabled ? next : undefined });
  }

  function safeParseBody(): unknown {
    const raw = route.responses[0]?.body;
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  return (
    <div className="bg-card/60 rounded-lg border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="hover:text-foreground text-muted-foreground flex w-full items-center gap-2 px-3 py-2 text-sm font-medium transition-colors"
        aria-expanded={open}
      >
        <ChevronDown
          aria-hidden="true"
          className={cn("size-4 transition-transform", open && "rotate-180")}
        />
        {t(K.title, { defaultValue: "Comportement" })}
        {(route.latency || route.failure || route.stateful || route.transform) && (
          <span className="bg-primary size-1.5 rounded-full" aria-hidden="true" />
        )}
      </button>
      {open && (
        <div className="flex flex-col gap-4 border-t px-3 py-3">
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold">{t(K.latency, { defaultValue: "Latence" })}</p>
            <div className="flex flex-wrap items-center gap-2">
              <NumberUnitField
                id="bh-lat-min"
                label={t(K.latencyMin, { defaultValue: "Min" })}
                value={latency?.minMs ?? 0}
                suffix="ms"
                width="w-24"
                onChange={(v) => setLatency({ minMs: v })}
              />
              <NumberUnitField
                id="bh-lat-max"
                label={t(K.latencyMax, { defaultValue: "Max" })}
                value={latency?.maxMs ?? 0}
                suffix="ms"
                width="w-24"
                onChange={(v) => setLatency({ maxMs: v })}
              />
              {(latency?.minMs ?? 0) === 0 && (latency?.maxMs ?? 0) === 0 && (
                <p className="text-muted-foreground/70 text-xs">
                  {t(K.latencyHint, { defaultValue: "0 / 0 = aucune latence" })}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold">{t(K.failure, { defaultValue: "Panne" })}</p>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                <Switch
                  checked={(failure?.probability ?? 0) > 0}
                  onCheckedChange={(on) =>
                    on ? setFailure({ probability: 0.25 }) : onChange({ failure: undefined })
                  }
                  aria-label={t(K.failureEnable, { defaultValue: "Activer les pannes" })}
                />
                {t(K.failureEnable, { defaultValue: "Activer" })}
              </label>
            </div>
            {(failure?.probability ?? 0) > 0 && (
              <div className="flex flex-col gap-2">
                <Label htmlFor={`bh-fail-proba`} className="text-xs text-muted-foreground">
                  {t(K.failureProbability, { defaultValue: "Probabilité" })} :{" "}
                  {Math.round((failure?.probability ?? 0) * 100)} %
                </Label>
                <input
                  id={`bh-fail-proba`}
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round((failure?.probability ?? 0) * 100)}
                  onChange={(e) => setFailure({ probability: Number(e.target.value) / 100 })}
                  className="h-1.5 w-full accent-primary"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={failure?.kind ?? "status"}
                    onValueChange={(v) =>
                      setFailure({ kind: v as NonNullable<MockRoute["failure"]>["kind"] })
                    }
                  >
                    <SelectTrigger
                      size="sm"
                      className="w-36"
                      aria-label={t(K.failureKind, { defaultValue: "Type de panne" })}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="status">
                        {t(K.kindStatus, { defaultValue: "Statut HTTP" })}
                      </SelectItem>
                      <SelectItem value="timeout">
                        {t(K.kindTimeout, { defaultValue: "Timeout" })}
                      </SelectItem>
                      <SelectItem value="reset">
                        {t(K.kindReset, { defaultValue: "Reset socket" })}
                      </SelectItem>
                      <SelectItem value="malformed">
                        {t(K.kindMalformed, { defaultValue: "Réponse malformée" })}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  {failure?.kind === "status" && (
                    <NumberUnitField
                      id="bh-fail-status"
                      label={t(K.failureStatusCode, { defaultValue: "Code d'erreur" })}
                      value={failure.statusCode ?? 500}
                      suffix=""
                      width="w-20"
                      onChange={(v) => setFailure({ statusCode: v || 500 })}
                    />
                  )}
                  {failure?.kind === "timeout" && (
                    <NumberUnitField
                      id="bh-fail-timeout"
                      label={t(K.failureTimeoutMs, { defaultValue: "Durée du timeout" })}
                      value={failure.timeoutMs ?? 5000}
                      suffix="ms"
                      width="w-24"
                      onChange={(v) => setFailure({ timeoutMs: v || 5000 })}
                    />
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold">{t(K.stateful, { defaultValue: "Stateful" })}</p>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                <Switch
                  checked={stateful?.enabled ?? false}
                  onCheckedChange={(on) => setStateful({ enabled: on })}
                  aria-label={t(K.statefulEnable, { defaultValue: "Activer le mode stateful" })}
                />
                {t(K.statefulEnable, { defaultValue: "Activer" })}
              </label>
            </div>
            {stateful?.enabled && (
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex w-40 flex-col gap-1">
                  <Label htmlFor={`bh-st-resource`} className="text-xs text-muted-foreground">
                    {t(K.statefulResource, { defaultValue: "Ressource" })}
                  </Label>
                  <Input
                    id={`bh-st-resource`}
                    value={stateful.resource ?? ""}
                    placeholder={t(K.statefulResourcePh, { defaultValue: "users" })}
                    onChange={(e) => setStateful({ resource: e.target.value || undefined })}
                    className="h-8 font-mono text-xs"
                  />
                </div>
                <div className="flex w-32 flex-col gap-1">
                  <Label htmlFor={`bh-st-idfield`} className="text-xs text-muted-foreground">
                    {t(K.statefulIdField, { defaultValue: "Champ id" })}
                  </Label>
                  <Input
                    id={`bh-st-idfield`}
                    value={stateful.idField ?? ""}
                    placeholder="id"
                    onChange={(e) => setStateful({ idField: e.target.value || undefined })}
                    className="h-8 font-mono text-xs"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold">
              {t(K.transform, { defaultValue: "Transform (JS)" })}
            </p>
            <Textarea
              value={route.transform ?? ""}
              onChange={(e) => onChange({ transform: e.target.value || undefined })}
              rows={5}
              spellCheck={false}
              className="font-mono text-xs"
              placeholder={'return { ...body, source: "mock" }'}
              aria-label={t(K.transform, { defaultValue: "Transform (JS)" })}
            />
            <p className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
              <AlertTriangle aria-hidden="true" className="size-3 shrink-0" />
              {t(K.transformWarning, {
                defaultValue: "Sandbox JS 250 ms — pas d'IO, pas de require.",
              })}
            </p>
            <TransformTester
              code={route.transform ?? ""}
              method={String(route.method).toUpperCase()}
              path={route.path}
              sampleBody={safeParseBody() ?? { id: 42 }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

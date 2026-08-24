"use client";

import { useState } from "react";
import { ChevronDown, Play } from "lucide-react";
import type { MockRoute } from "@reqly/mock-engine";
import { Button } from "@/components/ui/button";
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
import { runTransformLocal } from "./local-engine";

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
  transformTest: "mocks.behavior.transform.test",
  transformResult: "mocks.behavior.transform.result",
  transformError: "mocks.behavior.transform.error",
} as const;

interface BehaviorSectionProps {
  route: MockRoute;
  onChange: (patch: Partial<MockRoute>) => void;
}

export function BehaviorSection({ route, onChange }: BehaviorSectionProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [testOutput, setTestOutput] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

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

  function testTransform() {
    setTesting(true);
    setTestError(null);
    setTestOutput(null);
    try {
      const result = runTransformLocal(route.transform ?? "", {
        request: {
          method: String(route.method).toUpperCase(),
          path: route.path,
          query: { id: "42" },
          headers: {},
        },
        body: safeParse(route.responses[0]?.body) ?? { id: 42 },
        state: {},
      });
      setTestOutput(typeof result === "string" ? result : JSON.stringify(result, null, 2));
    } catch (err) {
      setTestError(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="rounded-lg border bg-card/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        aria-expanded={open}
      >
        <ChevronDown
          aria-hidden="true"
          className={cn("size-4 transition-transform", open && "rotate-180")}
        />
        {t(K.title, { defaultValue: "Comportement" })}
        {(route.latency || route.failure || route.stateful || route.transform) && (
          <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
        )}
      </button>
      {open && (
        <div className="flex flex-col gap-4 border-t px-3 py-3">
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold">{t(K.latency, { defaultValue: "Latence" })}</p>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex w-28 flex-col gap-1">
                <Label htmlFor={`bh-lat-min`} className="text-xs text-muted-foreground">
                  {t(K.latencyMin, { defaultValue: "Min (ms)" })}
                </Label>
                <Input
                  id={`bh-lat-min`}
                  type="number"
                  min={0}
                  value={latency?.minMs ?? 0}
                  onChange={(e) => setLatency({ minMs: Number(e.target.value) || 0 })}
                  className="h-8"
                />
              </div>
              <div className="flex w-28 flex-col gap-1">
                <Label htmlFor={`bh-lat-max`} className="text-xs text-muted-foreground">
                  {t(K.latencyMax, { defaultValue: "Max (ms)" })}
                </Label>
                <Input
                  id={`bh-lat-max`}
                  type="number"
                  min={0}
                  value={latency?.maxMs ?? 0}
                  onChange={(e) => setLatency({ maxMs: Number(e.target.value) || 0 })}
                  className="h-8"
                />
              </div>
              {(latency?.minMs ?? 0) === 0 && (latency?.maxMs ?? 0) === 0 && (
                <p className="text-xs text-muted-foreground/70">
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
                    <Input
                      type="number"
                      value={failure.statusCode ?? 500}
                      onChange={(e) => setFailure({ statusCode: Number(e.target.value) || 500 })}
                      className="h-8 w-24"
                      aria-label={t(K.failureStatusCode, { defaultValue: "Code d'erreur" })}
                    />
                  )}
                  {failure?.kind === "timeout" && (
                    <Input
                      type="number"
                      value={failure.timeoutMs ?? 5000}
                      onChange={(e) => setFailure({ timeoutMs: Number(e.target.value) || 5000 })}
                      className="h-8 w-28"
                      aria-label={t(K.failureTimeoutMs, { defaultValue: "Durée du timeout (ms)" })}
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
            <p className="text-[11px] text-amber-600 dark:text-amber-400">
              ⚠{" "}
              {t(K.transformWarning, {
                defaultValue: "Sandbox JS 250 ms — pas d'IO, pas de require.",
              })}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 w-fit text-xs"
              onClick={testTransform}
              disabled={testing || !route.transform}
            >
              <Play aria-hidden="true" className="size-3" />
              {t(K.transformTest, { defaultValue: "Tester" })}
            </Button>
            {(testOutput !== null || testError !== null) && (
              <div className="rounded-md border bg-muted/30 p-2">
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {testError
                    ? t(K.transformError, { defaultValue: "Erreur" })
                    : t(K.transformResult, { defaultValue: "Résultat" })}
                </p>
                <pre
                  className={cn(
                    "max-h-40 overflow-auto font-mono text-xs whitespace-pre-wrap",
                    testError && "text-destructive",
                  )}
                >
                  {testError ?? testOutput}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function safeParse(raw: string | undefined): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

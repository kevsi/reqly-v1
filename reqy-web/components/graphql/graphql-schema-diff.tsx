"use client";

import { useMemo, useState } from "react";
import { Diff, Trash2, Save, AlertOctagon, AlertTriangle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { persistence } from "@/lib/persistence";
import {
  buildClientSchema,
  findBreakingChanges,
  findDangerousChanges,
  type GraphQLSchema,
} from "graphql";
import { useTranslation } from "react-i18next";

const STORAGE_KEY = "reqly-graphql-schema-snapshots";

interface Snapshot {
  schema: unknown;
  savedAt: number;
}

function loadSnapshots(): Record<string, Snapshot> {
  if (typeof window === "undefined") return {};
  try {
    const raw = persistence.getItem<string>(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, Snapshot>) : {};
  } catch {
    return {};
  }
}

function saveSnapshots(snaps: Record<string, Snapshot>) {
  if (typeof window === "undefined") return;
  try {
    void persistence.setItem(STORAGE_KEY, JSON.stringify(snaps));
  } catch {
    /* ignore quota */
  }
}

/**
 * Convert an introspection result (or __schema object) to a GraphQLSchema instance.
 * Tolerates the various shapes the rest of the app passes around.
 */
function toGraphQLSchema(schema: unknown): GraphQLSchema | undefined {
  if (!schema) return undefined;
  try {
    if (typeof (schema as { getQueryType?: unknown }).getQueryType === "function") {
      return schema as GraphQLSchema;
    }
    const introspection = (schema as { data?: unknown }).data ?? schema;
    return buildClientSchema(introspection as Parameters<typeof buildClientSchema>[0]);
  } catch {
    return undefined;
  }
}

interface ChangeEntry {
  kind: "breaking" | "dangerous";
  type: string;
  description: string;
}

function buildClientSchemaSafe(raw: unknown): {
  schema: GraphQLSchema | null;
  error: string | null;
} {
  if (!raw) return { schema: null, error: "empty schema" };
  try {
    const s = toGraphQLSchema(raw);
    return { schema: s ?? null, error: s ? null : "could not build schema" };
  } catch (e) {
    return {
      schema: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

interface Props {
  schema?: unknown | null;
  endpoint?: string;
}

export function GraphqlSchemaDiff({ schema, endpoint }: Props) {
  const { t } = useTranslation();
  const [snapshotName, setSnapshotName] = useState("");
  const [snapshots, setSnapshots] = useState<Record<string, Snapshot>>(loadSnapshots);
  const [diffTarget, setDiffTarget] = useState<string>("");
  const [changes, setChanges] = useState<ChangeEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const saveSnapshot = () => {
    if (!schema || !snapshotName.trim()) return;
    const next = { ...snapshots, [snapshotName]: { schema, savedAt: Date.now() } };
    setSnapshots(next);
    saveSnapshots(next);
    setSnapshotName("");
  };

  const removeSnapshot = (name: string) => {
    const next = { ...snapshots };
    delete next[name];
    setSnapshots(next);
    saveSnapshots(next);
    if (diffTarget === name) {
      setDiffTarget("");
      setChanges(null);
      setError(null);
    }
  };

  const computeDiff = () => {
    setError(null);
    setChanges(null);
    if (!schema || !diffTarget || !snapshots[diffTarget]) {
      setError(t("graphql.schemaDiff.selectSnapshot"));
      return;
    }
    const currentBuild = buildClientSchemaSafe(schema);
    const snapshotBuild = buildClientSchemaSafe(snapshots[diffTarget].schema);
    if (currentBuild.error || !currentBuild.schema) {
      setError(t("graphql.schemaDiff.currentSchemaInvalid", { error: currentBuild.error }));
      return;
    }
    if (snapshotBuild.error || !snapshotBuild.schema) {
      setError(
        t("graphql.schemaDiff.snapshotInvalid", { name: diffTarget, error: snapshotBuild.error }),
      );
      return;
    }
    try {
      const breaking: Array<{ type: string; description: string }> = findBreakingChanges(
        snapshotBuild.schema,
        currentBuild.schema,
      ) as Array<{
        type: string;
        description: string;
      }>;
      const dangerous: Array<{ type: string; description: string }> = findDangerousChanges(
        snapshotBuild.schema,
        currentBuild.schema,
      ) as Array<{
        type: string;
        description: string;
      }>;
      const merged: ChangeEntry[] = [
        ...breaking.map((c) => ({ ...c, kind: "breaking" as const })),
        ...dangerous.map((c) => ({ ...c, kind: "dangerous" as const })),
      ];
      setChanges(merged);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const summary = useMemo(() => {
    if (!changes) return null;
    const breaking = changes.filter((c) => c.kind === "breaking").length;
    const dangerous = changes.filter((c) => c.kind === "dangerous").length;
    return { breaking, dangerous };
  }, [changes]);

  return (
    <div className="border-t bg-card p-2 space-y-2" data-testid="graphql-schema-diff">
      <div className="flex items-center gap-2">
        <input
          value={snapshotName}
          onChange={(e) => setSnapshotName(e.target.value)}
          placeholder={t("graphql.schemaDiff.snapshotPlaceholder")}
          className="flex-1 text-xs px-2 py-1 border rounded bg-background"
          data-testid="graphql-diff-snapshot-name"
        />
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={saveSnapshot}
          disabled={!schema || !snapshotName.trim()}
          data-testid="graphql-diff-save"
        >
          <Save className="w-3 h-3 mr-1" /> {t("graphql.schemaDiff.saveSnapshot")}
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <select
          value={diffTarget}
          onChange={(e) => setDiffTarget(e.target.value)}
          className="flex-1 text-xs px-2 py-1 border rounded bg-background"
          data-testid="graphql-diff-target"
        >
          <option value="">{t("graphql.schemaDiff.chooseSnapshot")}</option>
          {Object.entries(snapshots)
            .sort(([, a], [, b]) => b.savedAt - a.savedAt)
            .map(([name, snap]) => (
              <option key={name} value={name}>
                {name} ({new Date(snap.savedAt).toLocaleDateString()})
              </option>
            ))}
        </select>
        <Button
          size="sm"
          variant="default"
          className="h-7 text-xs"
          onClick={computeDiff}
          disabled={!schema || !diffTarget}
          data-testid="graphql-diff-compare"
        >
          <Diff className="w-3 h-3 mr-1" /> {t("graphql.schemaDiff.compare")}
        </Button>
      </div>

      {diffTarget && (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-[10px]"
          onClick={() => removeSnapshot(diffTarget)}
        >
          <Trash2 className="w-3 h-3 mr-1" /> {t("graphql.schemaDiff.deleteSnapshot")}
        </Button>
      )}

      {summary && (
        <div
          className="flex items-center gap-3 text-[11px] font-medium"
          data-testid="graphql-diff-summary"
        >
          <span
            className={
              summary.breaking > 0
                ? "text-destructive flex items-center gap-1"
                : "text-success flex items-center gap-1"
            }
          >
            <AlertOctagon className="w-3 h-3" />
            {summary.breaking} {t("graphql.schemaDiff.breaking")}
          </span>
          <span
            className={
              summary.dangerous > 0
                ? "text-warning flex items-center gap-1"
                : "text-muted-foreground flex items-center gap-1"
            }
          >
            <AlertTriangle className="w-3 h-3" />
            {summary.dangerous} {t("graphql.schemaDiff.dangerous")}
          </span>
        </div>
      )}

      <div
        className="text-xs font-mono bg-muted/30 p-2 rounded overflow-auto max-h-64 whitespace-pre-wrap space-y-1"
        data-testid="graphql-diff-output"
      >
        {error && (
          <div className="text-destructive flex items-center gap-1">
            <AlertOctagon className="w-3 h-3" /> {error}
          </div>
        )}
        {!error && !changes && (
          <div className="text-muted-foreground flex items-center gap-1">
            <Info className="w-3 h-3" />
            {t("graphql.schemaDiff.hint")}
          </div>
        )}
        {!error && changes && changes.length === 0 && (
          <div className="text-success">{t("graphql.schemaDiff.noChanges")}</div>
        )}
        {!error &&
          changes &&
          changes.map((c, i) => (
            <div
              key={`${c.kind}-${i}`}
              className={
                c.kind === "breaking"
                  ? "text-destructive flex items-start gap-1"
                  : "text-warning flex items-start gap-1"
              }
            >
              {c.kind === "breaking" ? (
                <AlertOctagon className="w-3 h-3 mt-0.5 shrink-0" />
              ) : (
                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
              )}
              <span>
                <span className="font-bold">{c.type}</span> — {c.description}
              </span>
            </div>
          ))}
      </div>

      {endpoint && (
        <p className="text-[10px] text-muted-foreground">
          {t("graphql.schemaDiff.endpointLabel")}: <span className="font-mono">{endpoint}</span>
        </p>
      )}
    </div>
  );
}

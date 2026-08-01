"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Save,
  GitCompare,
  Trash2,
  X,
  Camera,
  Check,
  AlertTriangle,
  Layers,
  Ban,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  saveRestSnapshot,
  compareRestSnapshot,
  listRestSnapshots,
  getRestSnapshot,
  deleteRestSnapshot,
} from "@/lib/rest-snapshot/store";
import type { FieldChange } from "@/lib/schema-diff";

// ── Helpers ──────────────────────────────────────────────────────────────

function parseResponseBody(body: string | undefined): unknown | undefined {
  if (body === undefined || body === null) return undefined;
  const trimmed = body.trim();
  if (trimmed === "") return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function describeChange(c: FieldChange): string {
  switch (c.kind) {
    case "added":
      return `Champ '${c.path}' ajouté (${c.to})`;
    case "removed":
      return `Champ '${c.path}' retiré (${c.from})`;
    case "type-changed":
    case "type-changed:null":
      return `Champ '${c.path}' type changé : ${c.from} → ${c.to}`;
  }
}

// ── Badge color for each change kind ─────────────────────────────────────

const changeBadge: Record<string, string> = {
  added: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200/40",
  removed: "bg-destructive/10 text-destructive border-destructive/20",
  "type-changed": "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-200/40",
  "type-changed:null": "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-200/40",
};

const changeIcon: Record<string, React.ReactNode> = {
  added: <Check className="size-3" />,
  removed: <X className="size-3" />,
  "type-changed": <AlertTriangle className="size-3" />,
  "type-changed:null": <Ban className="size-3" />,
};

// ── Component ────────────────────────────────────────────────────────────

interface RestSnapshotPanelProps {
  responseBody: string | undefined;
}

export function RestSnapshotPanel({ responseBody }: RestSnapshotPanelProps) {
  const [snapshotNames, setSnapshotNames] = useState<string[]>([]);
  const [newName, setNewName] = useState("");
  const [selectedName, setSelectedName] = useState("");
  const [diff, setDiff] = useState<{ name: string; changes: FieldChange[] } | null>(null);
  const [isJson, setIsJson] = useState(false);

  // Refresh snapshot list from localStorage
  const refresh = useCallback(() => {
    setSnapshotNames(listRestSnapshots());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Detect whether the current response is parseable JSON
  useEffect(() => {
    setIsJson(parseResponseBody(responseBody) !== undefined);
  }, [responseBody]);

  const parsed = parseResponseBody(responseBody);

  const handleSave = () => {
    const name = newName.trim();
    if (!name || parsed === undefined) return;
    if (getRestSnapshot(name)) {
      // Overwrite existing
    }
    saveRestSnapshot(name, parsed);
    setNewName("");
    refresh();
    setSelectedName(name);
    setDiff(null);
  };

  const handleCompare = () => {
    if (!selectedName || parsed === undefined) return;
    setDiff({
      name: selectedName,
      changes: compareRestSnapshot(selectedName, parsed),
    });
  };

  const handleDelete = (name: string) => {
    deleteRestSnapshot(name);
    refresh();
    if (selectedName === name) {
      setSelectedName("");
      setDiff(null);
    }
  };

  const handleCloseDiff = () => setDiff(null);

  const hasResponse = responseBody !== undefined && responseBody !== null && responseBody !== "";
  const canSave = newName.trim() && parsed !== undefined;
  const canCompare = selectedName && parsed !== undefined;

  return (
    <div className="space-y-2">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <Camera className="size-3.5" />
          Snapshots
          {snapshotNames.length > 0 && (
            <Badge variant="secondary" className="text-[10px] h-4 px-1">
              {snapshotNames.length}
            </Badge>
          )}
        </div>
        {!isJson && hasResponse && (
          <span className="text-[10px] text-muted-foreground/60">JSON only</span>
        )}
      </div>

      {/* ── Save new snapshot ────────────────────────────────────── */}
      <div className="flex items-center gap-1.5">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Nom du snapshot…"
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
          }}
          className="h-7 text-xs"
          disabled={!isJson || !hasResponse}
        />
        <Button
          size="sm"
          variant="default"
          className="h-7 gap-1 text-xs shrink-0"
          onClick={handleSave}
          disabled={!canSave}
          title="Sauvegarder le snapshot"
          data-testid="rest-snapshot-save"
        >
          <Save className="size-3" />
          Save
        </Button>
      </div>

      {/* ── Compare with existing ────────────────────────────────── */}
      {snapshotNames.length > 0 && (
        <div className="flex items-center gap-1.5">
          <select
            value={selectedName}
            onChange={(e) => {
              setSelectedName(e.target.value);
              setDiff(null);
            }}
            className="h-7 flex-1 rounded-md border border-border bg-muted/30 px-2 text-xs transition-colors hover:border-muted-foreground/30 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20"
          >
            <option value="">Choisir un snapshot…</option>
            {snapshotNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 text-xs shrink-0"
            onClick={handleCompare}
            disabled={!canCompare}
            title="Comparer avec la réponse actuelle"
            data-testid="rest-snapshot-compare"
          >
            <GitCompare className="size-3" />
            Compare
          </Button>
          {selectedName && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 size-7 p-0 text-destructive shrink-0"
              onClick={() => handleDelete(selectedName)}
              title="Supprimer ce snapshot"
            >
              <Trash2 className="size-3" />
            </Button>
          )}
        </div>
      )}

      {/* Empty state */}
      {snapshotNames.length === 0 && hasResponse && isJson && (
        <p className="text-[10px] text-muted-foreground/50 text-center py-1">
          Tapez un nom et cliquez Save pour créer un premier snapshot
        </p>
      )}

      {/* ── Diff results ─────────────────────────────────────────── */}
      {diff && (
        <div className="rounded-lg border border-border bg-muted/20 p-2 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
              <Layers className="size-3" />
              Diff avec « {diff.name} »
            </span>
            <button
              onClick={handleCloseDiff}
              className="rounded p-0.5 text-muted-foreground/50 hover:text-foreground transition-colors"
            >
              <X className="size-3" />
            </button>
          </div>

          {diff.changes.length === 0 ? (
            <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 py-1">
              <Check className="size-3.5" />
              Aucun changement détecté
            </div>
          ) : (
            <div className="space-y-0.5 max-h-48 overflow-auto">
              {diff.changes.map((c, i) => (
                <div
                  key={`${c.path}-${i}`}
                  className={cn(
                    "flex items-center gap-1.5 rounded px-1.5 py-1 text-[11px] font-mono border",
                    changeBadge[c.kind] || "bg-muted/30",
                  )}
                >
                  <span className="shrink-0">{changeIcon[c.kind]}</span>
                  <span className="truncate">{describeChange(c)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

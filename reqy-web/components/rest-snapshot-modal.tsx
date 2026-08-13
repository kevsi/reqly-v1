"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
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
  Plus,
  History,
  Copy,
  PencilLine,
  CalendarClock,
  ArrowRight,
  FileJson,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  saveRestSnapshot,
  compareRestSnapshot,
  listRestSnapshots,
  getSnapshotEntry,
  deleteRestSnapshot,
  renameRestSnapshot,
  hasRestSnapshot,
} from "@/lib/rest-snapshot/store";
import type { FieldChange } from "@/lib/schema-diff";
import type { SnapshotEntry } from "@/lib/rest-snapshot/store";

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

// ── Relative date formatting ────────────────────────────────────────────

function relativeDate(
  ms: number,
  t: (key: string, opts?: Record<string, number>) => string,
): string {
  if (!ms) return "";
  const diff = Date.now() - ms;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return t("snapshots.dateJustNow");
  const min = Math.floor(sec / 60);
  if (min < 60) return t("snapshots.dateMinutes", { count: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t("snapshots.dateHours", { count: hr });
  const days = Math.floor(hr / 24);
  if (days < 7) return t("snapshots.dateDays", { count: days });
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return t("snapshots.dateWeeks", { count: weeks });
  const months = Math.floor(days / 30);
  return t("snapshots.dateMonths", { count: months });
}

function formatDate(ms: number, language: string): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString(language === "fr" ? "fr-FR" : "en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_COLORS: Record<string, string> = {
  "2": "bg-emerald-500",
  "3": "bg-blue-500",
  "4": "bg-amber-500",
  "5": "bg-destructive",
};

function statusDot(code: number | undefined): string {
  if (!code) return "bg-muted-foreground/30";
  const prefix = String(code)[0];
  return STATUS_COLORS[prefix] || "bg-muted-foreground/30";
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

interface RestSnapshotModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  responseBody: string | undefined;
  responseStatus?: number;
  responseHeaders?: Record<string, string>;
}

export function RestSnapshotModal({
  open,
  onOpenChange,
  responseBody,
  responseStatus,
  responseHeaders,
}: RestSnapshotModalProps) {
  const { t, i18n } = useTranslation();
  // ── State ────────────────────────────────────────────────────────────
  const [snapshotNames, setSnapshotNames] = useState<string[]>([]);
  const [newName, setNewName] = useState("");
  const [selectedName, setSelectedName] = useState("");
  const [selectedEntry, setSelectedEntry] = useState<SnapshotEntry | null>(null);
  const [diff, setDiff] = useState<{ name: string; changes: FieldChange[] } | null>(null);
  const [isJson, setIsJson] = useState(false);

  // Rename state
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  // Overwrite confirmation
  const [pendingOverwrite, setPendingOverwrite] = useState<string | null>(null);

  // Detail view toggle
  const [showDetail, setShowDetail] = useState(false);
  const [copyOk, setCopyOk] = useState(false);

  // ── Derived ──────────────────────────────────────────────────────────
  const parsed = parseResponseBody(responseBody);
  const hasResponse = responseBody !== undefined && responseBody !== null && responseBody !== "";
  const canSave = newName.trim() && parsed !== undefined;

  // ── Refresh ──────────────────────────────────────────────────────────
  const refresh = useCallback(() => {
    setSnapshotNames(listRestSnapshots());
  }, []);

  const selectEntry = useCallback((name: string) => {
    setSelectedName(name);
    setDiff(null);
    const entry = getSnapshotEntry(name);
    setSelectedEntry(entry ?? null);
  }, []);

  useEffect(() => {
    if (open) {
      refresh();
      setDiff(null);
      setSelectedName("");
      setSelectedEntry(null);
      setNewName("");
      setPendingOverwrite(null);
      setRenameTarget(null);
      setShowDetail(false);
    }
  }, [open, refresh]);

  useEffect(() => {
    setIsJson(parseResponseBody(responseBody) !== undefined);
  }, [responseBody]);

  // ── Save / Overwrite ─────────────────────────────────────────────────
  const handleSave = () => {
    const name = newName.trim();
    if (!name || parsed === undefined) return;

    if (hasRestSnapshot(name) && pendingOverwrite !== name) {
      setPendingOverwrite(name);
      return;
    }

    saveRestSnapshot(name, parsed, {
      statusCode: responseStatus,
      responseHeaders,
      responseBody,
    });
    setPendingOverwrite(null);
    setNewName("");
    refresh();
    selectEntry(name);
  };

  const handleCancelOverwrite = () => {
    setPendingOverwrite(null);
  };

  // ── Compare ──────────────────────────────────────────────────────────
  const handleCompareWith = (name: string) => {
    if (!parsed) return;
    setDiff({
      name,
      changes: compareRestSnapshot(name, parsed),
    });
    setShowDetail(false);
  };

  const handleCloseDiff = () => setDiff(null);

  // ── Delete ───────────────────────────────────────────────────────────
  const handleDelete = (name: string) => {
    deleteRestSnapshot(name);
    refresh();
    if (selectedName === name) {
      setSelectedName("");
      setSelectedEntry(null);
      setDiff(null);
    }
  };

  // ── Rename ───────────────────────────────────────────────────────────
  const startRename = (name: string) => {
    setRenameTarget(name);
    setRenameDraft(name);
  };

  const commitRename = () => {
    if (!renameTarget) return;
    const trimmed = renameDraft.trim();
    if (trimmed && trimmed !== renameTarget) {
      const ok = renameRestSnapshot(renameTarget, trimmed);
      if (!ok) {
        // Name already exists — just revert
        setRenameTarget(null);
        return;
      }
      refresh();
      if (selectedName === renameTarget) {
        selectEntry(trimmed);
      }
    }
    setRenameTarget(null);
  };

  const cancelRename = () => {
    setRenameTarget(null);
  };

  // ── Copy body ────────────────────────────────────────────────────────
  const handleCopyBody = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyOk(true);
      setTimeout(() => setCopyOk(false), 1500);
    } catch {
      /* ignore */
    }
  };

  // ── Render helpers ───────────────────────────────────────────────────

  const changeLabel = (kind: string): string => {
    switch (kind) {
      case "added":
        return t("snapshots.kindAdded");
      case "removed":
        return t("snapshots.kindRemoved");
      case "type-changed":
        return t("snapshots.kindTypeChanged");
      case "type-changed:null":
        return t("snapshots.kindNullable");
      default:
        return kind;
    }
  };

  const renderDetailCard = () => {
    if (!selectedEntry) return null;
    const e = selectedEntry;

    return (
      <div className="rounded-lg border border-border/60 bg-card/30 overflow-hidden divide-y divide-border/40">
        {/* Status + Date row */}
        <div className="flex items-center gap-3 px-3 py-2.5">
          {e.statusCode && (
            <div className="flex items-center gap-1.5">
              <span className={cn("size-2 rounded-full", statusDot(e.statusCode))} />
              <span className="text-xs font-semibold tabular-nums">{e.statusCode}</span>
            </div>
          )}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarClock className="size-3" />
            <span title={formatDate(e.updatedAt, i18n.language)}>
              {relativeDate(e.updatedAt, t)}
            </span>
          </div>
          {e.createdAt !== e.updatedAt && (
            <span className="text-[10px] text-muted-foreground/50">
              {t("snapshots.created", { date: relativeDate(e.createdAt, t) })}
            </span>
          )}
          <span className="ml-auto text-[10px] text-muted-foreground/40">
            {formatDate(e.updatedAt, i18n.language)}
          </span>
        </div>

        {/* Headers table */}
        {e.responseHeaders && Object.keys(e.responseHeaders).length > 0 && (
          <div className="px-3 py-2 space-y-0.5 max-h-28 overflow-y-auto">
            {Object.entries(e.responseHeaders)
              .slice(0, 10)
              .map(([k, v]) => (
                <div key={k} className="flex gap-2 text-[11px] font-mono">
                  <span className="text-muted-foreground/60 shrink-0">{k}:</span>
                  <span className="text-foreground/70 truncate">{v}</span>
                </div>
              ))}
            {Object.keys(e.responseHeaders).length > 10 && (
              <div className="text-[10px] text-muted-foreground/40 pt-0.5">
                {t("snapshots.more", {
                  count: Object.keys(e.responseHeaders).length - 10,
                })}
              </div>
            )}
          </div>
        )}

        {/* Body preview */}
        {e.responseBody && (
          <div className="relative group">
            <button
              onClick={() => handleCopyBody(e.responseBody!)}
              className={cn(
                "absolute top-1.5 right-1.5 z-10 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] transition-all duration-150",
                copyOk
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "opacity-0 group-hover:opacity-100 bg-muted/60 hover:bg-muted text-muted-foreground",
              )}
            >
              {copyOk ? (
                <>
                  <Check className="size-3" /> {t("snapshots.copied")}
                </>
              ) : (
                <>
                  <Copy className="size-3" /> {t("common.copy")}
                </>
              )}
            </button>
            <pre className="text-[11px] font-mono leading-relaxed text-foreground/70 p-3 overflow-x-auto max-h-36 overflow-y-auto whitespace-pre-wrap break-all">
              {e.responseBody.slice(0, 2000)}
              {e.responseBody.length > 2000 && (
                <span className="text-muted-foreground/40">{t("snapshots.truncated")}</span>
              )}
            </pre>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 px-3 py-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs flex-1"
            onClick={() => handleCompareWith(selectedName)}
            disabled={!isJson}
          >
            <GitCompare className="size-3" />
            {t("snapshots.compare")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
            onClick={() => handleDelete(selectedName)}
            title={t("common.delete")}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>
    );
  };

  const renderDiffPanel = () => {
    if (!diff) return null;

    return (
      <div className="rounded-lg border border-border/50 bg-muted/5 overflow-hidden">
        {/* Diff header */}
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border/40">
          <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
            <Layers className="size-3.5" />
            {t("snapshots.diff")}
            <ArrowRight className="size-3 text-muted-foreground/40" />
            <span className="font-mono text-primary text-[11px]">« {diff.name} »</span>
          </span>
          <button
            onClick={handleCloseDiff}
            className="rounded p-0.5 text-muted-foreground/50 hover:text-foreground transition-colors"
          >
            <X className="size-3.5" />
          </button>
        </div>

        {diff.changes.length === 0 ? (
          <div className="flex items-center gap-2 px-3 py-3 text-sm text-emerald-600 dark:text-emerald-400">
            <div className="flex size-7 items-center justify-center rounded-md bg-emerald-500/10">
              <Check className="size-3.5" />
            </div>
            <span>{t("snapshots.noChangesIdentical")}</span>
          </div>
        ) : (
          <>
            {/* Summary badge */}
            <div className="px-3 pt-2 pb-1">
              <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                {t("snapshots.changesCount", { count: diff.changes.length })}
              </Badge>
            </div>
            {/* Changes list */}
            <div className="px-3 pb-3 space-y-1 max-h-48 overflow-y-auto">
              {diff.changes.map((c, i) => (
                <div
                  key={`${c.path}-${i}`}
                  className={cn(
                    "flex items-start gap-2 rounded-lg px-2.5 py-1.5 text-xs border",
                    changeBadge[c.kind] || "bg-muted/30",
                  )}
                >
                  <span className="mt-0.5 shrink-0">{changeIcon[c.kind]}</span>
                  <div className="min-w-0 flex-1">
                    <span className="font-mono text-[11px] break-all">{c.path}</span>
                    <span className="text-muted-foreground ml-1">
                      {c.kind === "added" && t("snapshots.changedAdded", { value: c.to })}
                      {c.kind === "removed" && t("snapshots.changedRemoved", { value: c.from })}
                      {c.kind.startsWith("type-changed") &&
                        t("snapshots.changedType", { from: c.from, to: c.to })}
                    </span>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[9px] h-4 px-1 shrink-0 mt-0.5",
                      c.kind === "added"
                        ? "border-emerald-200/30 text-emerald-600 dark:text-emerald-400"
                        : c.kind === "removed"
                          ? "border-destructive/20 text-destructive"
                          : "border-amber-200/30 text-amber-600 dark:text-amber-400",
                    )}
                  >
                    {changeLabel(c.kind)}
                  </Badge>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[1000px] max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden rounded-2xl">
        {/* ── Sticky Header ─────────────────────────────────────────── */}
        <DialogHeader className="px-6 pt-5 pb-3 shrink-0 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10">
              <Camera className="size-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-base font-semibold flex items-center gap-2">
                {t("snapshots.title")}
                {snapshotNames.length > 0 && (
                  <Badge variant="secondary" className="text-[10px] h-4 px-1.5 font-normal">
                    {snapshotNames.length}
                  </Badge>
                )}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                {t("snapshots.description")}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* ── Body: côte à côte ──────────────────────────────────────── */}
        {!hasResponse ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="rounded-2xl bg-muted/20 p-5 mb-3 ring-1 ring-border/40">
              <Camera className="size-8 text-muted-foreground/20" />
            </div>
            <p className="text-sm font-medium text-foreground/80">{t("snapshots.noResponse")}</p>
            <p className="text-xs text-muted-foreground/60 mt-1 max-w-[280px]">
              {t("snapshots.noResponseDesc")}
            </p>
          </div>
        ) : (
          <div className="flex-1 flex overflow-hidden">
            {/* ── Panneau gauche : snapshots ───────────────────────────── */}
            <div className="w-[380px] shrink-0 border-r border-border/40 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                {/* Non-JSON warning */}
                {!isJson && (
                  <div className="flex items-center gap-2 rounded-lg border border-amber-200/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="size-3.5 shrink-0" />
                    {t("snapshots.jsonOnlyWarning")}
                  </div>
                )}

                {/* New snapshot */}
                {isJson && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="flex size-6 items-center justify-center rounded-md bg-emerald-500/10">
                        <Plus className="size-3 text-emerald-600 dark:text-emerald-400" />
                      </div>
                      <h3 className="text-sm font-semibold">{t("snapshots.newTitle")}</h3>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Input
                        value={newName}
                        onChange={(e) => {
                          setNewName(e.target.value);
                          setPendingOverwrite(null);
                        }}
                        placeholder={t("snapshots.namePlaceholder")}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSave();
                          if (e.key === "Escape") handleCancelOverwrite();
                        }}
                        className="h-8 text-xs flex-1"
                        autoFocus
                      />
                      <div className="flex items-center gap-1 shrink-0">
                        {pendingOverwrite && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-xs"
                            onClick={handleCancelOverwrite}
                          >
                            {t("common.cancel")}
                          </Button>
                        )}
                        <Button
                          variant={pendingOverwrite ? "destructive" : "default"}
                          className={cn(
                            "h-8 gap-1 text-xs transition-all",
                            pendingOverwrite && "animate-pulse",
                          )}
                          onClick={handleSave}
                          disabled={!canSave}
                          data-testid="rest-snapshot-save"
                        >
                          <Save className="size-3" />
                          {pendingOverwrite ? t("snapshots.overwrite") : t("snapshots.save")}
                        </Button>
                      </div>
                    </div>
                    {pendingOverwrite && (
                      <p className="text-[10px] text-amber-600 dark:text-amber-400">
                        {t("snapshots.overwriteExists", { name: pendingOverwrite })}
                      </p>
                    )}
                  </div>
                )}

                {/* Snapshots list */}
                {snapshotNames.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="flex size-6 items-center justify-center rounded-md bg-violet-500/10">
                        <History className="size-3 text-violet-600 dark:text-violet-400" />
                      </div>
                      <h3 className="text-sm font-semibold">
                        {t("snapshots.savedTitle")}
                        <Badge variant="secondary" className="ml-2 text-[9px] h-3.5 px-1">
                          {snapshotNames.length}
                        </Badge>
                      </h3>
                    </div>

                    <div className="space-y-1 max-h-[400px] overflow-y-auto pr-1">
                      {snapshotNames.map((name) => {
                        const entry = getSnapshotEntry(name);
                        return (
                          <div
                            key={name}
                            className={cn(
                              "group flex items-center gap-1.5 rounded-lg border px-2.5 py-2 transition-all duration-150 cursor-pointer",
                              selectedName === name
                                ? "border-primary/30 bg-primary/5 shadow-sm"
                                : "border-border/60 hover:border-border hover:bg-muted/20",
                            )}
                            onClick={() => {
                              selectEntry(name);
                              setShowDetail(true);
                              setDiff(null);
                            }}
                          >
                            {renameTarget === name ? (
                              <div className="flex flex-1 items-center gap-1">
                                <Input
                                  value={renameDraft}
                                  onChange={(e) => setRenameDraft(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") commitRename();
                                    if (e.key === "Escape") cancelRename();
                                  }}
                                  onBlur={commitRename}
                                  className="h-6 text-xs flex-1"
                                  autoFocus
                                  onClick={(e) => e.stopPropagation()}
                                />
                              </div>
                            ) : (
                              <>
                                <span
                                  className={cn(
                                    "size-2 rounded-full shrink-0",
                                    statusDot(entry?.statusCode),
                                  )}
                                />
                                <span className="text-xs truncate flex-1">{name}</span>
                                {entry?.statusCode && (
                                  <Badge
                                    variant="outline"
                                    className="text-[8px] h-3.5 px-1 font-mono shrink-0"
                                  >
                                    {entry.statusCode}
                                  </Badge>
                                )}
                                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-5 w-5 p-0"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      startRename(name);
                                    }}
                                    title={t("snapshots.renameTitle")}
                                  >
                                    <PencilLine className="size-2.5 text-muted-foreground/70" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-5 w-5 p-0 text-destructive hover:text-destructive"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDelete(name);
                                    }}
                                    title={t("common.delete")}
                                  >
                                    <Trash2 className="size-2.5" />
                                  </Button>
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Empty saved */}
                {isJson && snapshotNames.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-6 text-center">
                    <FileJson className="size-6 text-muted-foreground/20 mb-2" />
                    <p className="text-xs font-medium text-foreground/60">
                      {t("snapshots.noSnapshot")}
                    </p>
                    <p className="text-[10px] text-muted-foreground/40 mt-0.5">
                      {t("snapshots.noSnapshotHint")}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* ── Panneau droit : détail ou diff ──────────────────────── */}
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto px-5 py-4">
                {diff ? (
                  renderDiffPanel()
                ) : selectedEntry && showDetail ? (
                  renderDetailCard()
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-center py-12">
                    <div className="rounded-xl bg-muted/10 p-4 mb-3 ring-1 ring-border/30">
                      <Camera className="size-7 text-muted-foreground/20" />
                    </div>
                    <p className="text-sm font-medium text-foreground/60">
                      {snapshotNames.length > 0
                        ? t("snapshots.selectSnapshot")
                        : t("snapshots.createFirstSnapshot")}
                    </p>
                    <p className="text-xs text-muted-foreground/40 mt-1 max-w-[260px]">
                      {snapshotNames.length > 0
                        ? t("snapshots.selectSnapshotHint")
                        : t("snapshots.saveToCompareHint")}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

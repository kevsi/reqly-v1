"use client";

import { useMemo, useState } from "react";
import { FileText, Rows3, Columns2, Columns3 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

import type { DiffFile, DiffHunk } from "@/hooks/use-git";

type LayoutMode = "unified" | "split" | "split-preview";

interface DiffViewerProps {
  files: DiffFile[];
  loading?: boolean;
}

const LAYOUT_MODES: LayoutMode[] = ["unified", "split", "split-preview"];

/** Reconstitue le contenu côté ancien depuis les hunks (indexé par numéro de ligne). */
function buildOldLines(hunks: DiffHunk[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.oldLineno != null && line.origin !== "add") {
        map.set(line.oldLineno, line.content);
      }
    }
  }
  return map;
}

/** Reconstitue le contenu côté nouveau depuis les hunks (indexé par numéro de ligne). */
function buildNewLines(hunks: DiffHunk[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.newLineno != null && line.origin !== "delete") {
        map.set(line.newLineno, line.content);
      }
    }
  }
  return map;
}

/** Contenu texte complet côté nouveau (pour l'aperçu). */
function buildNewText(hunks: DiffHunk[]): string {
  const lines = buildNewLines(hunks);
  const maxLine = Math.max(0, ...lines.keys());
  const out: string[] = [];
  for (let i = 1; i <= maxLine; i++) out.push(lines.get(i) ?? "");
  return out.join("\n");
}

export function GitDiffViewer({ files, loading }: DiffViewerProps) {
  const { t } = useTranslation();
  const [layout, setLayout] = useState<LayoutMode>("unified");

  const layoutMeta: Record<LayoutMode, { icon: typeof Columns2; title: string; label: string }> = {
    unified: { icon: Rows3, title: t("git.diffLayout1"), label: t("git.diffPanel1") },
    split: { icon: Columns2, title: t("git.diffLayout2"), label: t("git.diffPanel2") },
    "split-preview": { icon: Columns3, title: t("git.diffLayout3"), label: t("git.diffPanel3") },
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <span className="ml-2 text-xs text-muted-foreground">{t("git.diffComputing")}</span>
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-4 text-center">{t("git.diffNoDifferences")}</p>
    );
  }

  return (
    <div className="space-y-3">
      {/* Layout selector */}
      <div className="flex items-center gap-1 rounded-lg border border-border/40 bg-muted/20 p-0.5 w-fit">
        {LAYOUT_MODES.map((mode) => {
          const meta = layoutMeta[mode];
          const Icon = meta.icon;
          return (
            <button
              key={mode}
              type="button"
              onClick={() => setLayout(mode)}
              title={meta.title}
              aria-label={meta.title}
              aria-pressed={layout === mode}
              className={cn(
                "flex h-6 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium transition-colors",
                layout === mode
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-3" />
              {meta.label}
            </button>
          );
        })}
      </div>

      {files.map((file) => (
        <DiffFileBlock key={file.filepath} file={file} layout={layout} />
      ))}
    </div>
  );
}

function DiffFileBlock({ file, layout }: { file: DiffFile; layout: LayoutMode }) {
  const { t } = useTranslation();
  const lineCount = file.hunks.reduce((acc, h) => acc + h.lines.length, 0);
  const oldLines = useMemo(() => buildOldLines(file.hunks), [file.hunks]);
  const newLines = useMemo(() => buildNewLines(file.hunks), [file.hunks]);
  const newText = useMemo(() => buildNewText(file.hunks), [file.hunks]);
  const preview = useMemo(() => renderPreview(file.filepath, newText), [file.filepath, newText]);

  const showPreview = layout === "split-preview";

  return (
    <div className="overflow-hidden rounded-lg border border-border/60">
      {/* File header */}
      <div className="flex items-center gap-2 border-b border-border/40 bg-muted/30 px-3 py-1.5 text-xs font-medium text-foreground/80">
        <FileText className="size-3.5 text-muted-foreground" />
        {file.filepath}
        <span className="ml-auto text-[10px] text-muted-foreground/40">
          {lineCount} {t("git.diffLines")}
        </span>
      </div>

      <div
        className={cn(
          "flex items-stretch bg-background",
          showPreview && "divide-x divide-border/40",
        )}
      >
        {/* Diff pane(s) */}
        <div className="min-w-0 flex-1 overflow-x-auto">
          {layout === "unified" ? (
            <UnifiedDiff hunks={file.hunks} />
          ) : (
            <SplitDiff hunks={file.hunks} oldLines={oldLines} newLines={newLines} />
          )}
        </div>

        {/* Preview pane (3-panel mode) */}
        {showPreview && (
          <div className="w-[30%] min-w-[220px] max-w-[40%] shrink-0 overflow-auto">
            <div className="sticky top-0 border-b border-border/40 bg-muted/20 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
              {t("git.diffPreview")}
            </div>
            {preview}
          </div>
        )}
      </div>
    </div>
  );
}

/** Diff unifié (1 panneau) — le comportement d'origine. */
function UnifiedDiff({ hunks }: { hunks: DiffHunk[] }) {
  const { t } = useTranslation();
  return (
    <div>
      {hunks.map((hunk, hi) => (
        <div key={hi}>
          <div className="border-b border-border/20 bg-muted/10 px-3 py-1 font-mono text-[10px] text-muted-foreground/40">
            @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
          </div>
          {hunk.lines.slice(0, 500).map((line, li) => (
            <div
              key={li}
              className={cn(
                "flex font-mono text-[11px] leading-5",
                line.origin === "add" && "bg-success/5",
                line.origin === "delete" && "bg-destructive/5",
              )}
            >
              <span className="w-8 shrink-0 select-none px-1 text-right text-[10px] text-muted-foreground/30">
                {line.oldLineno ?? ""}
              </span>
              <span className="w-8 shrink-0 select-none border-r border-border/20 px-1 text-right text-[10px] text-muted-foreground/30">
                {line.newLineno ?? ""}
              </span>
              <span
                className={cn(
                  "w-4 shrink-0 select-none text-center",
                  line.origin === "add" && "text-success",
                  line.origin === "delete" && "text-destructive",
                  line.origin === "context" && "text-muted-foreground/40",
                )}
              >
                {line.origin === "add" ? "+" : line.origin === "delete" ? "-" : " "}
              </span>
              <span className="flex-1 whitespace-pre px-1">{line.content}</span>
            </div>
          ))}
          {hunk.lines.length > 500 && (
            <p className="px-3 py-1 text-[10px] text-muted-foreground/40">
              {t("git.diffMoreLines", { count: hunk.lines.length - 500 })}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Diff côte à côte (2 ou 3 panneaux) : ancien à gauche, nouveau à droite,
 * chaque ligne de diff alignée sur deux cellules.
 */
function SplitDiff({
  hunks,
  oldLines,
  newLines,
}: {
  hunks: DiffHunk[];
  oldLines: Map<number, string>;
  newLines: Map<number, string>;
}) {
  const rows: {
    kind: "context" | "add" | "delete";
    content: string;
    old?: number;
    new?: number;
  }[] = [];
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.origin === "add") {
        rows.push({ kind: "add", content: line.content, new: line.newLineno ?? undefined });
      } else if (line.origin === "delete") {
        rows.push({ kind: "delete", content: line.content, old: line.oldLineno ?? undefined });
      } else {
        rows.push({
          kind: "context",
          content: line.content,
          old: line.oldLineno ?? undefined,
          new: line.newLineno ?? undefined,
        });
      }
    }
  }
  return (
    <div>
      {rows.map((row, i) => {
        const left =
          row.kind === "delete" || row.kind === "context"
            ? row.content
            : row.old != null
              ? (oldLines.get(row.old) ?? "")
              : "";
        const right =
          row.kind === "add" || row.kind === "context"
            ? row.content
            : row.new != null
              ? (newLines.get(row.new) ?? "")
              : "";
        return (
          <div
            key={i}
            className="grid grid-cols-2 divide-x divide-border/30 border-b border-border/10 font-mono text-[11px] leading-5"
          >
            <SplitCell
              content={left}
              kind={row.kind === "delete" ? "delete" : row.kind === "add" ? "gap" : "context"}
            />
            <SplitCell
              content={right}
              kind={row.kind === "add" ? "add" : row.kind === "delete" ? "gap" : "context"}
            />
          </div>
        );
      })}
    </div>
  );
}

function SplitCell({
  content,
  kind,
}: {
  content: string;
  kind: "add" | "delete" | "context" | "gap";
}) {
  return (
    <div
      className={cn(
        "flex whitespace-pre px-2",
        kind === "add" && "bg-success/5 text-foreground",
        kind === "delete" && "bg-destructive/5 text-foreground",
        kind === "context" && "text-muted-foreground",
        kind === "gap" && "bg-muted/5 text-muted-foreground/20",
      )}
    >
      <span
        className={cn(
          "w-4 shrink-0 select-none",
          kind === "add" && "text-success",
          kind === "delete" && "text-destructive",
          kind === "context" && "text-muted-foreground/40",
        )}
      >
        {kind === "add" ? "+" : kind === "delete" ? "-" : " "}
      </span>
      <span className="min-w-0 flex-1 truncate">{content}</span>
    </div>
  );
}

/** Rend l'aperçu : JSON joli pour les fichiers JSON, texte brut sinon. */
function renderPreview(filepath: string, text: string): React.ReactNode {
  const isJson = filepath.endsWith(".json");
  if (isJson) {
    try {
      const parsed: unknown = JSON.parse(text);
      return (
        <pre className="p-2 text-[11px] leading-5 text-foreground/90">
          {JSON.stringify(parsed, null, 2)}
        </pre>
      );
    } catch {
      // pas du JSON valide → affichage brut ci-dessous
    }
  }
  return (
    <pre className="whitespace-pre-wrap break-words p-2 text-[11px] leading-5 text-foreground/80">
      {text || "—"}
    </pre>
  );
}

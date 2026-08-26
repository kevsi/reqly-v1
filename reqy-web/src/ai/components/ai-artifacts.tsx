"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FileCode2,
  ChevronRight,
  X,
  Copy,
  Check,
  Download,
  Code2,
  Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Artifact } from "@/src/ai/components/ai-sidebar-types";
import { AiMarkdown } from "@/src/ai/components/ai-markdown";

// ── Carte artefact — sous le message assistant ─────────────────────────────

interface CardProps {
  artifact: Artifact;
  onOpen: (artifact: Artifact) => void;
}

export function AiArtifactCard({ artifact, onOpen }: CardProps) {
  const { t } = useTranslation();
  const subtitle =
    artifact.kind === "html"
      ? t("ai.artifact.previewGenerated")
      : artifact.language
        ? `${t("ai.artifact.title")} · ${artifact.language}`
        : t("ai.artifact.codeBlock");

  return (
    <button
      type="button"
      onClick={() => onOpen(artifact)}
      className="flex w-full max-w-md items-center gap-3 rounded-lg border border-border bg-card p-2.5 text-left transition-colors hover:bg-muted/50"
      data-testid="ai-artifact-card"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <FileCode2 className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{artifact.title}</span>
        <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

// ── Panneau artefact — overlay pleine hauteur dans la sidebar ──────────────

interface PanelProps {
  artifact: Artifact;
  onClose: () => void;
  /** Classes additionnelles (mode split : hauteur partielle dans la sidebar). */
  className?: string;
}

function download(artifact: Artifact) {
  const blob = new Blob([artifact.content], {
    type: artifact.kind === "html" ? "text/html" : "text/plain",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = artifact.title;
  a.click();
  URL.revokeObjectURL(url);
}

export function AiArtifactPanel({ artifact, onClose, className }: PanelProps) {
  const { t } = useTranslation();
  const defaultTab: "preview" | "code" =
    artifact.kind === "html" || artifact.kind === "markdown" ? "preview" : "code";
  const [tab, setTab] = useState<"preview" | "code">(defaultTab);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(artifact.content);
      setCopyFailed(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // P3 — échec clipboard (permission refusée) : ne pas laisser croire à un succès.
      setCopied(false);
      setCopyFailed(true);
      setTimeout(() => setCopyFailed(false), 2000);
    }
  };

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden bg-background",
        className,
      )}
      data-testid="ai-artifact-panel"
    >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-4 py-3">
        <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <FileCode2 className="size-4 shrink-0 text-primary" />
          <span className="truncate">{artifact.title}</span>
        </span>
        <button
          type="button"
          onClick={onClose}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label={t("common.close")}
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Tabs — Aperçu disponible pour HTML ET markdown */}
      <div className="flex shrink-0 border-b border-border/60 px-2">
        {(artifact.kind === "html" || artifact.kind === "markdown") && (
          <button
            type="button"
            onClick={() => setTab("preview")}
            className={cn(
              "flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs transition-colors",
              tab === "preview"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Eye className="size-3.5" />
            {t("ai.artifact.tabPreview")}
          </button>
        )}
        <button
          type="button"
          onClick={() => setTab("code")}
          className={cn(
            "flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs transition-colors",
            tab === "code"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <Code2 className="size-3.5" />
          {t("ai.artifact.tabCode")}
        </button>
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "preview" && artifact.kind === "html" ? (
          <iframe
            title={artifact.title}
            srcDoc={artifact.content}
            sandbox="allow-scripts"
            className="h-full w-full bg-background"
          />
        ) : tab === "preview" && artifact.kind === "markdown" ? (
          <div className="h-full overflow-y-auto p-4">
            <AiMarkdown content={artifact.content} />
          </div>
        ) : (
          <pre className="h-full overflow-auto bg-muted/30 p-4 font-mono text-xs leading-relaxed text-foreground">
            {artifact.content}
          </pre>
        )}
      </div>

      {/* Footer actions */}
      <div className="flex shrink-0 items-center justify-between border-t border-border/60 px-4 py-2.5 text-xs text-muted-foreground">
        <span>{copyFailed ? t("ai.artifact.copyFailed") : artifact.language ?? artifact.kind}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 transition-colors hover:bg-muted hover:text-foreground"
          >
            {copied ? (
              <Check className="size-3.5 text-success" />
            ) : (
              <Copy className="size-3.5" />
            )}
            {t("common.copy")}
          </button>
          <button
            type="button"
            onClick={() => download(artifact)}
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 transition-colors hover:bg-muted hover:text-foreground"
          >
            <Download className="size-3.5" />
            {t("ai.artifact.download")}
          </button>
        </div>
      </div>
    </div>
  );
}

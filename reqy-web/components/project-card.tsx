"use client";

import { Trash2, RefreshCw, FolderOpen, GitBranch } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SavedProject } from "@/lib/config";
import { useTranslation } from "react-i18next";

const FRAMEWORK_COLORS: Record<string, string> = {
  express:
    "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400 dark:border-emerald-500/20",
  fastapi:
    "bg-teal-500/15 text-teal-600 border-teal-500/30 dark:text-teal-400 dark:border-teal-500/20",
  nestjs: "bg-red-500/15 text-red-600 border-red-500/30 dark:text-red-400 dark:border-red-500/20",
  laravel:
    "bg-orange-500/15 text-orange-600 border-orange-500/30 dark:text-orange-400 dark:border-orange-500/20",
  django:
    "bg-green-500/15 text-green-600 border-green-500/30 dark:text-green-400 dark:border-green-500/20",
  unknown: "bg-muted text-muted-foreground border-border",
};

const FRAMEWORK_ICONS: Record<string, string> = {
  express: "⚡",
  fastapi: "🚀",
  nestjs: "🐱",
  laravel: "🌸",
  django: "🎸",
  unknown: "📦",
};

function fmt(iso: string, language: string) {
  return new Date(iso).toLocaleDateString(language, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

interface ProjectCardProps {
  project: SavedProject;
  isActive?: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onReanalyze: () => void;
  isReanalyzing?: boolean;
}

export const ProjectCard: React.FC<ProjectCardProps> = ({
  project,
  isActive = false,
  onSelect,
  onDelete,
  onReanalyze,
  isReanalyzing = false,
}) => {
  const { t, i18n } = useTranslation();
  const fw = project.framework || "unknown";
  const colors = FRAMEWORK_COLORS[fw] ?? FRAMEWORK_COLORS.unknown;

  return (
    <button
      type="button"
      className={cn(
        "group relative flex flex-col gap-3 rounded-xl border p-4 transition-all duration-200 cursor-pointer hover:shadow-md hover:-translate-y-0.5 text-left w-full",
        isActive
          ? "border-primary/50 bg-primary/5 shadow-sm shadow-primary/10"
          : "border-border bg-card hover:border-border/80",
      )}
      onClick={onSelect}
    >
      {/* Framework badge */}
      <div className="flex items-start justify-between gap-2">
        <span className="text-2xl" role="img" aria-label={fw}>
          {FRAMEWORK_ICONS[fw] ?? "📦"}
        </span>
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            colors,
          )}
        >
          {fw}
        </span>
      </div>

      {/* Name */}
      <div className="min-w-0">
        <h3 className="truncate font-semibold text-foreground">{project.name}</h3>
        <p className="truncate text-xs text-muted-foreground mt-0.5">
          {project.folderPath}
          {project.language ? ` · ${project.language}` : ""}
        </p>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <GitBranch className="size-3" />
          {t("myProjects.cardRoutes", { count: project.routes.length })}
        </span>
        <span className="ml-auto">{fmt(project.analyzedAt, i18n.language)}</span>
      </div>

      {/* Analysis warnings — e.g. low-confidence fallback or no manifest */}
      {project.warnings && project.warnings.length > 0 && (
        <p
          className="truncate text-[11px] text-amber-600 dark:text-amber-400"
          title={project.warnings.join("\n")}
        >
          ⚠ {project.warnings[0]}
        </p>
      )}

      {/* Mode chip */}
      <div
        className={cn(
          "inline-flex w-fit items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium",
          project.mode === "ai"
            ? "bg-purple-500/10 text-purple-600"
            : "bg-blue-500/10 text-blue-600",
        )}
      >
        {project.mode === "ai" ? t("myProjects.modeAi") : t("myProjects.modeStatic")}
      </div>

      {/* Actions — revealed on hover */}
      <div
        className="absolute bottom-3 right-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onReanalyze}
          title={isReanalyzing ? t("myProjects.reanalyzing") : t("myProjects.reanalyze")}
          disabled={isReanalyzing}
          className={cn(
            "flex size-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors",
            isReanalyzing
              ? "cursor-not-allowed opacity-50"
              : "hover:text-foreground hover:bg-accent",
          )}
        >
          <RefreshCw className={cn("size-3.5", isReanalyzing ? "animate-spin" : "")} />
        </button>
        <button
          type="button"
          onClick={onDelete}
          title={t("myProjects.delete")}
          className="flex size-7 items-center justify-center rounded-md border border-border bg-background text-destructive hover:bg-destructive/10 transition-colors"
        >
          <Trash2 className="size-3.5" />
        </button>
        <button
          onClick={onSelect}
          title={t("myProjects.open")}
          className="flex h-7 items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 text-[11px] font-medium text-primary hover:bg-primary/20 transition-colors"
        >
          <FolderOpen className="size-3" /> {t("myProjects.open")}
        </button>
      </div>
    </button>
  );
};

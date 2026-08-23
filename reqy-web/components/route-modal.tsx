"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import type { SavedProject } from "../lib/types";
import { useRequestStore } from "@/hooks/use-request-store";
import { useShallow } from "zustand/react/shallow";
import type { LucideIcon } from "lucide-react";
import {
  Layers,
  CheckCircle,
  Copy,
  Shield,
  ShieldOff,
  ChevronRight,
  FileText,
  Search,
  X,
  Route,
  Lock,
  Unlock,
  Code2,
  Link2,
  Loader2,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { methodSubtle } from "@/lib/http-method-colors";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useTranslation } from "react-i18next";

interface RouteModalProps {
  project: SavedProject | null;
  open: boolean;
  onClose: () => void;
}

const METHOD_OPTIONS = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS", "GRAPHQL"];

const CONFIDENCE_DOT: Record<string, string> = {
  HIGH: "bg-success",
  MEDIUM: "bg-warning",
  LOW: "bg-muted-foreground/40",
};

function StatItem({
  icon: Icon,
  value,
  label,
  valueClassName,
}: {
  icon: LucideIcon;
  value: number;
  label: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="size-3.5 text-muted-foreground/70" />
      <span className={cn("text-sm font-semibold text-foreground", valueClassName)}>{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

export function RouteModal({ project, open, onClose }: RouteModalProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [methodFilter, setMethodFilter] = useState<string>("all");
  const [authOnly, setAuthOnly] = useState(false);
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const { addCollection, addRequestToCollection } = useRequestStore(
    useShallow((s) => ({
      addCollection: s.addCollection,
      addRequestToCollection: s.addRequestToCollection,
    })),
  );

  const resetFilters = useCallback(() => {
    setSearch("");
    setMethodFilter("all");
    setAuthOnly(false);
  }, []);

  // Reset l'état de filtre/expansion à chaque ouverture ou changement de projet
  useEffect(() => {
    if (open) {
      // Reset filter/expansion state each time the modal opens.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      resetFilters();
      setExpandedPath(null);
      setCreatedId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.name, open]);

  const handleCreateCollection = useCallback(async () => {
    if (!project) return;
    setCreating(true);
    setCreatedId(null);
    try {
      const baseUrl = `http://localhost:${project.port ?? 3000}`;
      const colName = t("routeModal.collectionName", {
        framework: project.framework,
        name: project.name,
      });
      const colId = addCollection({
        name: colName,
        description: t("routeModal.collectionDesc", {
          count: project.routes.length,
          name: project.name,
        }),
        color: "emerald",
        icon: "package",
      });
      setCreatedId(colId);
      const added: string[] = [];
      for (const route of project.routes) {
        addRequestToCollection(colId, {
          name: `${route.method} ${route.path}`,
          method: route.method,
          url: `${baseUrl}${route.path}`,
          endpoint: route.path,
          headers: Object.fromEntries((route.headers ?? []).map((h) => [h.key, h.value])),
          body: route.body || undefined,
          bodyType:
            route.bodyType === "json"
              ? "json"
              : route.bodyType === "form"
                ? "form-data"
                : route.body
                  ? "raw"
                  : undefined,
          queryParams: (route.headers ?? [])
            .filter((h): h is { key: string; value: string } => h.key.startsWith("?"))
            .map((h) => ({ key: h.key.slice(1), value: h.value })),
        });
        added.push(`${route.method} ${route.path}`);
      }
      toast({
        title: t("routeModal.addedToCollection", {
          count: added.length,
          name: colName,
          port: project.port ?? 3000,
        }),
        meta: { event: "collectionComplete" },
      });
    } catch (err) {
      toast({ title: t("newProject.error", { error: String(err) }), variant: "destructive" });
      setCreatedId(null);
    } finally {
      setCreating(false);
    }
  }, [project, addCollection, addRequestToCollection, t]);

  const handleCopy = useCallback(
    async (text: string, label: string) => {
      try {
        await navigator.clipboard.writeText(text);
        toast({
          title: t("routeModal.copied", { label }),
          description: text,
          meta: { event: "copy" },
        });
      } catch {
        toast({ title: t("routeModal.copyFailed", { label }), variant: "destructive" });
      }
    },
    [t],
  );

  const stats = useMemo(() => {
    const routes = project?.routes ?? [];
    return {
      total: routes.length,
      auth: routes.filter((r) => r.authRequired).length,
      json: routes.filter((r) => r.bodyType === "json").length,
      form: routes.filter((r) => r.bodyType === "form").length,
      high: routes.filter((r) => r.confidence === "HIGH").length,
      frontend: routes.filter((r) => r.actuallyUsedByFrontend).length,
    };
  }, [project?.routes]);

  const filtered = useMemo(() => {
    const routes = project?.routes ?? [];
    return routes.filter((r) => {
      if (methodFilter !== "all" && r.method !== methodFilter) return false;
      if (authOnly && !r.authRequired) return false;
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        r.path.toLowerCase().includes(q) ||
        r.method.toLowerCase().includes(q) ||
        (r.name ?? "").toLowerCase().includes(q) ||
        (r.description ?? "").toLowerCase().includes(q) ||
        (r.sourceFile ?? "").toLowerCase().includes(q)
      );
    });
  }, [project?.routes, methodFilter, authOnly, search]);

  const headerMeta = useMemo(() => {
    if (!project) return "";
    return [
      project.framework,
      project.language,
      t("routeModal.routesCount", { count: stats.total }),
      project.port ? `${t("routeModal.port")} ${project.port}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }, [project, stats.total, t]);

  if (!project) return null;

  const hasActiveFilters = search !== "" || methodFilter !== "all" || authOnly;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[85vh] max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl"
      >
        {/* ── Header ── */}
        <div className="flex-none border-b border-border px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Route className="size-4" />
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold text-foreground">{project.name}</h2>
                <p className="truncate text-xs text-muted-foreground">{headerMeta}</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() =>
                  filtered.length &&
                  handleCopy(filtered.map((r) => `${r.method} ${r.path}`).join("\n"), "Routes")
                }
                disabled={!filtered.length}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <Copy className="size-3.5" /> {t("routeModal.copy")}
              </button>
              <button
                type="button"
                onClick={handleCreateCollection}
                disabled={creating || !project.routes.length}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  createdId
                    ? "cursor-default border border-success/40 bg-success/10 text-success"
                    : "bg-primary text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40",
                )}
              >
                {creating ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : createdId ? (
                  <CheckCircle className="size-3.5" />
                ) : (
                  <Layers className="size-3.5" />
                )}
                {creating
                  ? t("routeModal.creating")
                  : createdId
                    ? t("routeModal.collectionCreated")
                    : t("routeModal.collection")}
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label={t("routeModal.close")}
                className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>

          {/* Stat strip — couleur réservée aux 3 stats vraiment notables */}
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
            <StatItem icon={Route} value={stats.total} label={t("routeModal.total")} />
            <StatItem
              icon={Shield}
              value={stats.high}
              label={t("routeModal.highConfidence")}
              valueClassName={stats.high > 0 ? "text-success" : undefined}
            />
            <StatItem
              icon={Lock}
              value={stats.auth}
              label={t("routeModal.protectedRoutes")}
              valueClassName={stats.auth > 0 ? "text-warning" : undefined}
            />
            <StatItem
              icon={Link2}
              value={stats.frontend}
              label={t("routeModal.usedByFrontend")}
              valueClassName={stats.frontend > 0 ? "text-primary" : undefined}
            />
            <StatItem icon={Code2} value={stats.json} label="JSON" />
            {stats.form > 0 && <StatItem icon={FileText} value={stats.form} label="FormData" />}
          </div>

          {/* Analysis warnings — tokens sémantiques, pas de hex hardcodé */}
          {project.warnings && project.warnings.length > 0 && (
            <div className="mt-3 flex flex-col gap-1 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2">
              {project.warnings.map((w, i) => (
                <p key={i} className="text-[11px] leading-snug text-warning">
                  ⚠ {w}
                </p>
              ))}
            </div>
          )}
        </div>

        {/* ── Filters ── */}
        <div className="flex-none border-b border-border px-5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("routeModal.searchPlaceholder")}
                className="h-8 pl-8 pr-8 text-sm"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                  aria-label={t("routeModal.clearSearch")}
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            <Select value={methodFilter} onValueChange={setMethodFilter}>
              <SelectTrigger className="h-8 w-[110px] text-xs" size="sm">
                <SelectValue placeholder={t("routeModal.method")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("routeModal.all")}</SelectItem>
                {METHOD_OPTIONS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button
              type="button"
              onClick={() => setAuthOnly((v) => !v)}
              aria-pressed={authOnly}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                authOnly
                  ? "border-warning/40 bg-warning/10 text-warning"
                  : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {authOnly ? <Lock className="size-3.5" /> : <Unlock className="size-3.5" />}
              {t("routeModal.protectedRoutes")}
            </button>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
              >
                {t("routeModal.resetFilters")}
              </button>
            )}
            <span className="ml-auto text-xs text-muted-foreground">
              {filtered.length}/{stats.total}
            </span>
          </div>
        </div>

        {/* ── Route list ── */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Route className="size-8 text-muted-foreground/25" />
              <p className="mt-3 text-sm text-muted-foreground">{t("routeModal.noRoutes")}</p>
              {hasActiveFilters ? (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {t("routeModal.resetFilters")}
                </button>
              ) : (
                <p className="text-xs text-muted-foreground">{t("routeModal.noRoutesHint")}</p>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              {filtered.map((route) => {
                const key = `${route.method}-${route.path}`;
                const expanded = expandedPath === key;
                const confidenceDot =
                  CONFIDENCE_DOT[route.confidence ?? "LOW"] ?? "bg-muted-foreground/40";
                return (
                  <div
                    key={key}
                    className={cn(
                      "group rounded-lg border transition-colors",
                      expanded
                        ? "border-border bg-muted/30"
                        : "border-transparent hover:border-border hover:bg-muted/20",
                    )}
                  >
                    {/* Collapsed row — toggle et copy sont des siblings (pas de bouton imbriqué) */}
                    <div className="flex items-center">
                      <button
                        type="button"
                        onClick={() => setExpandedPath(expanded ? null : key)}
                        aria-expanded={expanded}
                        className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
                      >
                        <ChevronRight
                          className={cn(
                            "size-3.5 shrink-0 text-muted-foreground/60 transition-transform",
                            expanded && "rotate-90",
                          )}
                        />
                        <span
                          className={cn(
                            "inline-flex h-6 min-w-[52px] items-center justify-center rounded-md border px-2 text-[11px] font-bold uppercase tracking-wider",
                            methodSubtle[route.method] ?? methodSubtle["GET"],
                          )}
                        >
                          {route.method}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-mono text-sm text-foreground">
                          {route.name || route.path}
                        </span>
                        <span className="hidden shrink-0 items-center gap-2 sm:flex">
                          <span
                            className={cn("size-1.5 rounded-full", confidenceDot)}
                            title={`${t("routeModal.confidence")}: ${(route.confidence ?? "LOW").toLowerCase()}`}
                          />
                          {route.authRequired ? (
                            <Shield className="size-3 text-warning" />
                          ) : (
                            <ShieldOff className="size-3 text-muted-foreground/30" />
                          )}
                          {route.bodyType && route.bodyType !== "none" && (
                            <Badge
                              variant="outline"
                              className="h-5 text-[10px] font-normal text-muted-foreground"
                            >
                              {route.bodyType}
                            </Badge>
                          )}
                          {route.sourceFile && (
                            <span className="hidden max-w-[120px] truncate text-xs text-muted-foreground/70 xl:block">
                              {route.sourceFile.split("/").pop()}
                            </span>
                          )}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCopy(route.path, "Route")}
                        className="mr-1 shrink-0 rounded p-1.5 text-muted-foreground opacity-100 transition-colors hover:text-foreground sm:opacity-0 sm:focus-visible:opacity-100 sm:group-hover:opacity-100"
                        title={t("routeModal.copyPath")}
                        aria-label={t("routeModal.copyPath")}
                      >
                        <Copy className="size-3" />
                      </button>
                    </div>

                    {/* Expanded details — panel de propriétés, colonne d'icônes alignée */}
                    {expanded && (
                      <div className="border-t border-border/70 px-3 pb-3 pt-3">
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1.1fr_1fr]">
                          <div className="space-y-3">
                            <div>
                              <p className="mb-1 text-[11px] font-medium text-muted-foreground">
                                {t("routeModal.path")}
                              </p>
                              <div className="rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1.5 font-mono text-sm break-all text-foreground">
                                {route.path}
                              </div>
                            </div>
                            {route.sourceFile && (
                              <div>
                                <p className="mb-1 text-[11px] font-medium text-muted-foreground">
                                  {t("routeModal.sourceFile")}
                                </p>
                                <p className="font-mono text-xs break-all text-muted-foreground">
                                  {route.sourceFile}
                                </p>
                              </div>
                            )}
                            {route.description && (
                              <div>
                                <p className="mb-1 text-[11px] font-medium text-muted-foreground">
                                  {t("routeModal.description")}
                                </p>
                                <p className="text-xs leading-relaxed text-foreground">
                                  {route.description}
                                </p>
                              </div>
                            )}
                          </div>

                          <div className="space-y-3">
                            <div>
                              <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">
                                {t("routeModal.metadata")}
                              </p>
                              <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
                                <dl className="grid grid-cols-[16px_1fr] items-center gap-x-2.5 gap-y-1.5 text-xs">
                                  <dt
                                    aria-hidden
                                    className="flex items-center text-muted-foreground"
                                  >
                                    {route.authRequired ? (
                                      <Lock className="size-3" />
                                    ) : (
                                      <Unlock className="size-3" />
                                    )}
                                  </dt>
                                  <dd className="text-foreground">
                                    {route.authType ||
                                      (route.authRequired
                                        ? t("routeModal.protected")
                                        : t("routeModal.public"))}
                                  </dd>

                                  <dt
                                    aria-hidden
                                    className="flex items-center text-muted-foreground"
                                  >
                                    <Code2 className="size-3" />
                                  </dt>
                                  <dd className="text-foreground">{route.bodyType}</dd>

                                  <dt
                                    aria-hidden
                                    className="flex items-center text-muted-foreground"
                                  >
                                    <span className={cn("size-1.5 rounded-full", confidenceDot)} />
                                  </dt>
                                  <dd className="text-foreground capitalize">
                                    {(route.confidence || "LOW").toLowerCase()}
                                  </dd>

                                  {route.actuallyUsedByFrontend && (
                                    <>
                                      <dt aria-hidden className="flex items-center text-primary">
                                        <Link2 className="size-3" />
                                      </dt>
                                      <dd className="text-primary">
                                        {t("routeModal.usedByFrontend")}
                                      </dd>
                                    </>
                                  )}

                                  {route.controller && (
                                    <>
                                      <dt
                                        aria-hidden
                                        className="flex items-center text-muted-foreground"
                                      >
                                        <FileText className="size-3" />
                                      </dt>
                                      <dd className="truncate text-foreground">
                                        {typeof route.controller === "string"
                                          ? route.controller
                                          : "controller"}
                                      </dd>
                                    </>
                                  )}
                                </dl>
                              </div>
                            </div>

                            {route.middlewareChain && route.middlewareChain.length > 0 && (
                              <div>
                                <p className="mb-1 text-[11px] font-medium text-muted-foreground">
                                  {t("routeModal.middleware")}
                                </p>
                                <div className="flex flex-wrap gap-1">
                                  {route.middlewareChain.map((mw) => (
                                    <span
                                      key={mw}
                                      className="rounded-md border border-border/60 bg-muted/30 px-2 py-0.5 font-mono text-[10px] text-muted-foreground"
                                    >
                                      {mw}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {route.reasonings && route.reasonings.length > 0 && (
                              <div>
                                <p className="mb-1 text-[11px] font-medium text-muted-foreground">
                                  {t("routeModal.detection")}
                                </p>
                                <ul className="space-y-0.5">
                                  {route.reasonings.map((r, i) => (
                                    <li
                                      key={i}
                                      className="flex items-start gap-1.5 text-[11px] text-muted-foreground"
                                    >
                                      <span className="mt-1 block size-1 shrink-0 rounded-full bg-muted-foreground/30" />
                                      {r}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

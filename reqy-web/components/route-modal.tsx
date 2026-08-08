import { useState, useCallback } from "react";
import type { SavedProject } from "../lib/types";
import { useRequestStore } from "@/hooks/use-request-store";
import { useShallow } from "zustand/react/shallow";
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
  Info,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

const methodConfig: Record<string, { color: string; bg: string }> = {
  GET: { color: "text-success", bg: "bg-success/10" },
  POST: { color: "text-primary", bg: "bg-primary/10" },
  PUT: { color: "text-warning", bg: "bg-warning/10" },
  PATCH: { color: "text-secondary-foreground", bg: "bg-secondary/30" },
  DELETE: { color: "text-destructive", bg: "bg-destructive/10" },
};

interface RouteModalProps {
  project: SavedProject | null;
  open: boolean;
  onClose: () => void;
}

export function RouteModal({ project, onClose }: RouteModalProps) {
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

  const handleCreateCollection = useCallback(async () => {
    if (!project) return;
    setCreating(true);
    setCreatedId(null);
    try {
      const baseUrl = `http://localhost:${project.port ?? 3000}`;
      const colName = `Collection ${project.framework} · ${project.name}`;
      const colId = addCollection({
        name: colName,
        description: `${project.routes.length} routes détectées dans « ${project.name} »`,
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
        title: `${added.length} requête(s) ajoutée(s) à la collection « ${colName} » (port ${project.port ?? 3000})`,
        meta: { event: "collectionComplete" },
      });
    } catch (err) {
      toast({ title: `Erreur : ${String(err)}`, variant: "destructive" });
      setCreatedId(null);
    } finally {
      setCreating(false);
    }
  }, [project, addCollection, addRequestToCollection]);

  const handleCopy = useCallback(async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: `${label} copié`, description: text, meta: { event: "copy" } });
    } catch {
      toast({ title: `Impossible de copier ${label}`, variant: "destructive" });
    }
  }, []);

  if (!project) return null;

  const stats = {
    total: project.routes.length,
    auth: project.routes.filter((r) => r.authRequired).length,
    json: project.routes.filter((r) => r.bodyType === "json").length,
    form: project.routes.filter((r) => r.bodyType === "form").length,
    high: project.routes.filter((r) => r.confidence === "HIGH").length,
    med: project.routes.filter((r) => r.confidence === "MEDIUM").length,
  };

  const filtered = project.routes.filter((r) => {
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

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="absolute inset-0 z-50 flex items-center justify-center p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-full max-w-4xl max-h-[88vh] overflow-hidden rounded-2xl border border-border bg-card shadow-2xl flex flex-col">
          {/* ── Header ── */}
          <div className="flex-none border-b border-border px-5 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2.5">
                  <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Route className="size-4" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold truncate">{project.name}</h2>
                    <p className="text-xs text-muted-foreground">
                      {project.framework} · {stats.total} routes
                      {project.port ? ` · Port ${project.port}` : ""}
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    filtered.length &&
                    handleCopy(filtered.map((r) => `${r.method} ${r.path}`).join("\n"), "Routes")
                  }
                  disabled={!filtered.length}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Copy className="size-3.5" /> Copier
                </button>
                <button
                  type="button"
                  onClick={handleCreateCollection}
                  disabled={creating || !project.routes.length}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors",
                    createdId
                      ? "border-success/40 bg-success/10 text-success cursor-default"
                      : "border-border bg-background text-foreground hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed",
                  )}
                >
                  {creating ? (
                    <CheckCircle className="size-3.5 animate-pulse" />
                  ) : createdId ? (
                    <CheckCircle className="size-3.5" />
                  ) : (
                    <Layers className="size-3.5" />
                  )}
                  {creating ? "Création…" : createdId ? "Collection créée" : "Collection"}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex size-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>
            {/* Stats bar */}
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                <Route className="size-3" /> {stats.total} total
              </span>
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs",
                  stats.high > 0 ? "bg-success/10 text-success" : "bg-muted text-muted-foreground",
                )}
              >
                <Shield className="size-3" /> {stats.high} haute confiance
              </span>
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs",
                  stats.auth > 0 ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground",
                )}
              >
                <Lock className="size-3" /> {stats.auth} protégées
              </span>
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs",
                  stats.json > 0 ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                )}
              >
                <Code2 className="size-3" /> {stats.json} JSON
              </span>
              {stats.form > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-secondary/30 px-2.5 py-1 text-xs text-secondary-foreground">
                  <FileText className="size-3" /> {stats.form} FormData
                </span>
              )}
            </div>
          </div>

          {/* ── Filters ── */}
          <div className="flex-none border-b border-border px-5 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Rechercher une route…"
                  className="h-8 pl-8 text-sm"
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
              <Select value={methodFilter} onValueChange={setMethodFilter}>
                <SelectTrigger className="h-8 w-[110px] text-xs" size="sm">
                  <SelectValue placeholder="Méthode" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes</SelectItem>
                  <SelectItem value="GET">GET</SelectItem>
                  <SelectItem value="POST">POST</SelectItem>
                  <SelectItem value="PUT">PUT</SelectItem>
                  <SelectItem value="DELETE">DELETE</SelectItem>
                  <SelectItem value="PATCH">PATCH</SelectItem>
                </SelectContent>
              </Select>
              <button
                type="button"
                onClick={() => setAuthOnly(!authOnly)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors",
                  authOnly
                    ? "border-warning/40 bg-warning/10 text-warning"
                    : "border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted",
                )}
              >
                {authOnly ? <Lock className="size-3.5" /> : <Unlock className="size-3.5" />}
                {authOnly ? "Protégées" : "Toutes"}
              </button>
              <span className="text-xs text-muted-foreground">
                {filtered.length}/{stats.total}
              </span>
            </div>
          </div>

          {/* ── Route list ── */}
          <div className="flex-1 min-h-0 overflow-y-auto p-4">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Route className="size-10 text-muted-foreground/30" />
                <p className="mt-3 text-sm text-muted-foreground">Aucune route trouvée</p>
                <p className="text-xs text-muted-foreground">Essayez de modifier les filtres</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {filtered.map((route) => {
                  const key = `${route.method}-${route.path}`;
                  const expanded = expandedPath === key;
                  const mc = methodConfig[route.method] || methodConfig["GET"];
                  return (
                    <div
                      key={key}
                      className={cn(
                        "group rounded-xl border transition-all",
                        expanded
                          ? "border-border bg-muted/40"
                          : "border-transparent hover:border-border hover:bg-muted/20",
                      )}
                    >
                      {/* Collapsed row */}
                      <button
                        type="button"
                        onClick={() => setExpandedPath(expanded ? null : key)}
                        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left"
                      >
                        <ChevronRight
                          className={cn(
                            "size-3.5 shrink-0 text-muted-foreground transition-transform",
                            expanded && "rotate-90",
                          )}
                        />
                        <span
                          className={cn(
                            "inline-flex h-6 min-w-[52px] items-center justify-center rounded-md px-2 text-[11px] font-bold uppercase tracking-wider",
                            mc.bg,
                            mc.color,
                          )}
                        >
                          {route.method}
                        </span>
                        <span className="flex-1 min-w-0 font-mono text-sm truncate text-foreground">
                          {route.name || route.path}
                        </span>
                        <div className="hidden sm:flex items-center gap-1.5 shrink-0">
                          {route.authRequired ? (
                            <Shield className="size-3 text-warning" />
                          ) : (
                            <ShieldOff className="size-3 text-muted-foreground/40" />
                          )}
                          {route.bodyType && route.bodyType !== "none" && (
                            <Badge
                              variant="outline"
                              className="h-5 text-[10px] font-normal text-muted-foreground"
                            >
                              {route.bodyType}
                            </Badge>
                          )}
                          {route.confidence && (
                            <span
                              className={cn(
                                "text-[10px] font-semibold uppercase",
                                route.confidence === "HIGH"
                                  ? "text-success"
                                  : route.confidence === "MEDIUM"
                                    ? "text-warning"
                                    : "text-muted-foreground/50",
                              )}
                            >
                              {route.confidence === "HIGH"
                                ? "●"
                                : route.confidence === "MEDIUM"
                                  ? "◐"
                                  : "○"}
                            </span>
                          )}
                          {route.sourceFile && (
                            <span className="hidden xl:block max-w-[120px] truncate text-xs text-muted-foreground">
                              {route.sourceFile.split("/").pop()}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopy(route.path, "Route");
                          }}
                          className="shrink-0 rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground transition-all"
                          title="Copier le chemin"
                        >
                          <Copy className="size-3" />
                        </button>
                      </button>

                      {/* Expanded details */}
                      {expanded && (
                        <div className="border-t border-border px-3 pb-3 pt-2.5">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="space-y-2">
                              <div>
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                  Chemin
                                </span>
                                <div className="mt-0.5 rounded-lg bg-muted/60 px-2.5 py-1.5 font-mono text-sm break-all">
                                  {route.path}
                                </div>
                              </div>
                              {route.sourceFile && (
                                <div>
                                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                    Fichier source
                                  </span>
                                  <p className="mt-0.5 text-xs text-muted-foreground break-all">
                                    {route.sourceFile}
                                  </p>
                                </div>
                              )}
                              {route.description && (
                                <div>
                                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                    Description
                                  </span>
                                  <p className="mt-0.5 text-xs text-foreground">
                                    {route.description}
                                  </p>
                                </div>
                              )}
                            </div>
                            <div className="space-y-2">
                              <div>
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                  Métadonnées
                                </span>
                                <div className="mt-0.5 flex flex-wrap gap-1.5">
                                  <span
                                    className={cn(
                                      "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium",
                                      route.authRequired
                                        ? "bg-warning/10 text-warning"
                                        : "bg-muted text-muted-foreground",
                                    )}
                                  >
                                    {route.authRequired ? (
                                      <Lock className="size-3" />
                                    ) : (
                                      <Unlock className="size-3" />
                                    )}
                                    {route.authType ||
                                      (route.authRequired ? "protégée" : "publique")}
                                  </span>
                                  <span
                                    className={cn(
                                      "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium",
                                      route.bodyType === "none"
                                        ? "bg-muted/50 text-muted-foreground/50"
                                        : "bg-muted text-muted-foreground",
                                    )}
                                  >
                                    <Code2 className="size-3" /> body: {route.bodyType}
                                  </span>
                                  <span
                                    className={cn(
                                      "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium",
                                      route.confidence === "HIGH"
                                        ? "bg-success/10 text-success"
                                        : route.confidence === "MEDIUM"
                                          ? "bg-warning/10 text-warning"
                                          : "bg-muted text-muted-foreground",
                                    )}
                                  >
                                    <Info className="size-3" /> confiance:{" "}
                                    {(route.confidence || "LOW").toLowerCase()}
                                  </span>
                                  {route.controller && (
                                    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground">
                                      <FileText className="size-3" />{" "}
                                      {typeof route.controller === "string"
                                        ? route.controller
                                        : "controller"}
                                    </span>
                                  )}
                                </div>
                              </div>
                              {route.middlewareChain && route.middlewareChain.length > 0 && (
                                <div>
                                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                    Middleware
                                  </span>
                                  <div className="mt-0.5 flex flex-wrap gap-1">
                                    {route.middlewareChain.map((mw) => (
                                      <span
                                        key={mw}
                                        className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-mono text-muted-foreground"
                                      >
                                        {mw}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {route.reasonings && route.reasonings.length > 0 && (
                                <div>
                                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                    Détection
                                  </span>
                                  <ul className="mt-0.5 space-y-0.5">
                                    {route.reasonings.map((r, i) => (
                                      <li
                                        key={i}
                                        className="flex items-start gap-1.5 text-[11px] text-muted-foreground"
                                      >
                                        <span className="mt-0.5 block size-1 shrink-0 rounded-full bg-muted-foreground/30" />
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
        </div>
      </div>
    </div>
  );
}

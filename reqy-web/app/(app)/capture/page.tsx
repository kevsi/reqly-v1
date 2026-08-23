"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { formatTime, extractHost, prettyJson } from "@/lib/capture-utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Loader2,
  Play,
  Square,
  RefreshCw,
  Wand2,
  CheckCircle2,
  Trash2,
  Database,
  Search,
  X,
  Network,
  ChevronRight,
  Clock,
  Globe,
  Copy,
  Check,
  Download,
  FileJson,
  Send,
  Activity,
  Layers,
  Sparkles,
  Terminal,
  AlertTriangle,
} from "lucide-react";
import { useRequestStore } from "@/hooks/use-request-store";
import {
  isTauriAvailable,
  listCapturedSessions,
  getCapturedSession,
  getCaptureProxyStatus,
  startCaptureProxy,
  stopCaptureProxy,
  clearCapturedSessions,
  deleteCapturedSession,
  formatErrorMessage,
  type CapturedSummary,
  type CapturedRequest,
} from "@/lib/tauri";
import { generateCollectionFromCapture, type ExportBundle } from "@/lib/capture-to-test/generate";
import {
  exportCaptureAsHar,
  exportCaptureAsOpenApi,
  exportCaptureAsMockBundle,
  capturedToCurl,
  redactCapturedSession,
} from "@/lib/capture-exporters";
import { downloadJson } from "@/lib/utils";
import type { HttpMethod } from "@/lib/types";
import type { Assertion } from "@/lib/test-runner/types";

const PRESET_PORTS = [8080, 3000, 8888, 9090];
const WEB_POLL_INTERVAL_MS = 2000;

const METHOD_COLORS: Record<string, string> = {
  GET: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800",
  POST: "bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-400 border-sky-200 dark:border-sky-800",
  PUT: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400 border-amber-200 dark:border-amber-800",
  PATCH:
    "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-400 border-violet-200 dark:border-violet-800",
  DELETE:
    "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400 border-rose-200 dark:border-rose-800",
};

function methodColor(method: string): string {
  return (
    METHOD_COLORS[method.toUpperCase()] ??
    "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400 border-slate-200 dark:border-slate-700"
  );
}

function statusColor(status: number | null | undefined): string {
  if (status == null) return "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400";
  if (status >= 500) return "bg-destructive/15 text-destructive border-destructive/20";
  if (status >= 400) return "bg-warning/15 text-warning border-warning/20";
  if (status >= 300)
    return "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400 border-sky-200 dark:border-sky-800";
  if (status >= 200)
    return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20";
  return "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400";
}

function describeAssertion(a: Assertion): string {
  switch (a.type) {
    case "status": {
      if (typeof a.expected === "number") return `status == ${a.expected}`;
      if (a.expected && typeof a.expected === "object" && "in" in a.expected)
        return `status in [${a.expected.in.join(", ")}]`;
      if (a.expected && typeof a.expected === "object" && "not" in a.expected)
        return `status != ${a.expected.not}`;
      return "status assertion";
    }
    case "jsonPath":
      return `body.${a.path} ${a.operator}`;
    case "schema":
      return "response matches inferred JSON schema";
    case "responseTime":
      return `response time ${a.operator} ${a.valueMs}ms`;
    default:
      return "assertion";
  }
}

function toSummary(c: CapturedRequest): CapturedSummary {
  return { id: c.id, method: c.method, url: c.url, timestamp: c.timestamp };
}

function KeyValueList({ pairs, empty }: { pairs: Array<[string, string]>; empty: string }) {
  if (!pairs || pairs.length === 0) {
    return <p className="text-xs italic text-muted-foreground">{empty}</p>;
  }
  return (
    <ul className="divide-y rounded-md border text-xs bg-muted/20">
      {pairs.map(([k, v], i) => (
        <li key={i} className="flex gap-2 px-3 py-1.5 hover:bg-muted/40 transition-colors">
          <span className="font-semibold text-muted-foreground shrink-0 font-mono">{k}:</span>
          <span className="break-all font-mono text-foreground/90">{v}</span>
        </li>
      ))}
    </ul>
  );
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        // Fallback : sélection + execCommand pour les contextes sans Clipboard API
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        try {
          document.execCommand("copy");
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* copie impossible — silencieux */
        }
        document.body.removeChild(textarea);
      });
  };
  return (
    <button
      type="button"
      onClick={copy}
      title={label}
      className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-all shadow-xs"
    >
      {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
      {copied ? t("capturePage.copied") : label}
    </button>
  );
}

export default function CapturePage() {
  const { addCollection, addRequestToCollection } = useRequestStore();
  const { t } = useTranslation();

  const [port, setPort] = useState<number>(8080);
  const [running, setRunning] = useState(false);
  const [sessions, setSessions] = useState<CapturedSummary[]>([]);
  const [statusById, setStatusById] = useState<Record<string, number | null>>({});
  const [selected, setSelected] = useState<CapturedRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bundle, setBundle] = useState<ExportBundle | null>(null);
  const [collectionName, setCollectionName] = useState<string>("");
  const [savedName, setSavedName] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [methodFilter, setMethodFilter] = useState<string | null>(null);
  const [groupByHost, setGroupByHost] = useState(false);
  const [activeDrawerTab, setActiveDrawerTab] = useState<"overview" | "headers" | "body" | "curl">(
    "overview",
  );
  const [droppedCount, setDroppedCount] = useState(0);
  const [redactExports, setRedactExports] = useState(true);

  const runningRef = useRef(running);
  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  /** `true` si l'erreur concerne un problème de port (port déjà utilisé, etc.). */
  const isPortError = (msg: string) =>
    /\bport\b|bind|déjà utilis/.test(msg.toLowerCase()) &&
    !/authentification|indisponible|connectez-vous/.test(msg.toLowerCase());

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const list = await listCapturedSessions();
      setSessions(list);
      setStatusById((prev) => {
        const next = { ...prev };
        for (const s of list) {
          // En mode web, le statut vient directement de la liste ; en mode
          // desktop il sera complété par les événements Tauri.
          if (s.status != null) next[s.id] = s.status;
          else if (!(s.id in next)) next[s.id] = null;
        }
        return next;
      });
    } catch (e) {
      setError(formatErrorMessage(e));
    }
  }, []);

  // Web : resynchronise l'état "running" avec le serveur (l'état peut avoir
  // changé dans un autre onglet, ou après un rechargement).
  useEffect(() => {
    if (isTauriAvailable()) return;
    let cancelled = false;
    const sync = async () => {
      try {
        const status = await getCaptureProxyStatus();
        if (!cancelled && status) {
          setRunning(status.running);
          if (status.droppedCount != null) setDroppedCount(status.droppedCount);
        }
      } catch {
        // silencieux : l'état sera retenté au prochain rafraîchissement
      }
    };
    void sync();
    const timer = window.setInterval(sync, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    if (!isTauriAvailable()) return;
    let unsubs: Array<() => void> = [];
    let cancelled = false;
    Promise.all([
      listen<CapturedRequest>("captured-request", (e) => {
        const c = e.payload;
        setSessions((prev) => (prev.some((x) => x.id === c.id) ? prev : [toSummary(c), ...prev]));
        setStatusById((s) => ({ ...s, [c.id]: c.status ?? null }));
      }),
      listen<CapturedRequest>("captured-request-updated", (e) => {
        const c = e.payload;
        setStatusById((s) => ({ ...s, [c.id]: c.status ?? null }));
        setSessions((prev) =>
          prev.map((x) => (x.id === c.id ? { ...x, timestamp: c.timestamp } : x)),
        );
        setSelected((sel) => (sel && sel.id === c.id ? c : sel));
      }),
    ])
      .then((unsubFns) => {
        if (!cancelled) unsubs = unsubFns as Array<() => void>;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
    };
  }, []);

  useEffect(() => {
    if (isTauriAvailable()) return;
    if (!running) return;
    const id = window.setInterval(() => {
      void refresh();
    }, WEB_POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [running, refresh]);

  const startProxy = async () => {
    setError(null);
    setBusy(true);
    try {
      await startCaptureProxy(port);
      setRunning(true);
      setDroppedCount(0);
      setSessions([]);
      setStatusById({});
      setBundle(null);
      setSavedName(null);
      setSelected(null);
    } catch (e) {
      setError(formatErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const stopProxy = async () => {
    setError(null);
    setBusy(true);
    try {
      await stopCaptureProxy();
      setRunning(false);
      await refresh();
    } catch (e) {
      setError(formatErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const clearAll = async () => {
    setError(null);
    setBusy(true);
    try {
      await clearCapturedSessions();
      setSessions([]);
      setStatusById({});
      setSelected(null);
      setBundle(null);
      setSavedName(null);
    } catch (e) {
      setError(formatErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const openDetail = async (id: string) => {
    setError(null);
    try {
      const full = await getCapturedSession(id);
      if (full) {
        setSelected(full);
        setActiveDrawerTab("overview");
      }
    } catch (e) {
      setError(formatErrorMessage(e));
    }
  };

  const generate = async () => {
    setError(null);
    setBundle(null);
    setSavedName(null);
    setBusy(true);
    try {
      const list = await listCapturedSessions();
      setSessions(list);
      const detailed: CapturedRequest[] = [];
      for (const s of list) {
        const full = await getCapturedSession(s.id);
        if (full) detailed.push(full);
      }
      if (detailed.length === 0) {
        setError(t("capturePage.noSessionsGenerate"));
        return;
      }
      const generated = generateCollectionFromCapture(detailed);
      setBundle(generated);
      setCollectionName(generated.collections[0].name);
    } catch (e) {
      setError(formatErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (!bundle) return;
    const col = bundle.collections[0];
    const newId = addCollection({
      name: collectionName.trim() || col.name,
      color: col.color,
      icon: col.icon,
      description: col.description,
    });
    for (const req of col.requests) addRequestToCollection(newId, req);
    setSavedName(collectionName.trim() || col.name);
  };

  const loadAllFullSessions = async (): Promise<CapturedRequest[]> => {
    const list = await listCapturedSessions();
    const detailed: CapturedRequest[] = [];
    for (const s of list) {
      const full = await getCapturedSession(s.id);
      if (full) detailed.push(full);
    }
    return detailed;
  };

  const handleExportHar = async () => {
    setError(null);
    setBusy(true);
    try {
      const detailed = await loadAllFullSessions();
      if (detailed.length === 0) {
        setError(t("capturePage.noSessionsExport"));
        return;
      }
      const data = redactExports ? detailed.map((s) => redactCapturedSession(s)) : detailed;
      const harContent = exportCaptureAsHar(data);
      // downloadJson gère la boîte de dialogue native sur desktop (Tauri v1/v2)
      // et le téléchargement navigateur sur le web.
      await downloadJson(JSON.parse(harContent), `capture-${Date.now()}.har`);
    } catch (e) {
      setError(formatErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const handleExportOpenApi = async () => {
    setError(null);
    setBusy(true);
    try {
      const detailed = await loadAllFullSessions();
      if (detailed.length === 0) {
        setError(t("capturePage.noSessionsExport"));
        return;
      }
      const data = redactExports ? detailed.map((s) => redactCapturedSession(s)) : detailed;
      const openapi = exportCaptureAsOpenApi(data);
      await downloadJson(openapi, `openapi-capture-${Date.now()}.json`);
    } catch (e) {
      setError(formatErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const handleExportMocks = async () => {
    setError(null);
    setBusy(true);
    try {
      const detailed = await loadAllFullSessions();
      if (detailed.length === 0) {
        setError(t("capturePage.noSessionsExport"));
        return;
      }
      const data = redactExports ? detailed.map((s) => redactCapturedSession(s)) : detailed;
      const mockBundle = exportCaptureAsMockBundle(data);
      await downloadJson(mockBundle, `mocks-capture-${Date.now()}.json`);
    } catch (e) {
      setError(formatErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const handleReplayRequest = (req: CapturedRequest) => {
    const colId = addCollection({
      name: `${t("capturePage.replay")} ${req.method} ${extractHost(req.url)}`,
      color: "sky",
      icon: "send",
      description: `Replayed from capture ${new Date().toLocaleTimeString()}`,
    });
    const headersRecord: Record<string, string> = {};
    if (req.headers) {
      for (const [k, v] of req.headers) {
        if (k) headersRecord[k] = v;
      }
    }
    addRequestToCollection(colId, {
      name: `${req.method} ${req.url}`,
      method: req.method as HttpMethod,
      url: req.url,
      endpoint: req.url,
      headers: headersRecord,
      body: req.body ?? undefined,
      runnerAssertions: [],
    });
    setSavedName(`${t("capturePage.replay")} ${req.method} added to workspace`);
  };

  const filtered = useMemo(() => {
    let items = sessions;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      items = items.filter((s) => s.url.toLowerCase().includes(q));
    }
    if (methodFilter) {
      items = items.filter((s) => s.method.toUpperCase() === methodFilter);
    }
    return items;
  }, [sessions, searchQuery, methodFilter]);

  const grouped = useMemo(() => {
    if (!groupByHost) return null;
    const map = new Map<string, CapturedSummary[]>();
    for (const s of filtered) {
      const host = extractHost(s.url);
      if (!map.has(host)) map.set(host, []);
      map.get(host)!.push(s);
    }
    return map;
  }, [filtered, groupByHost]);

  const uniqueMethods = useMemo(() => {
    return [...new Set(sessions.map((s) => s.method.toUpperCase()))];
  }, [sessions]);

  const hostsCount = useMemo(() => {
    return new Set(sessions.map((s) => extractHost(s.url))).size;
  }, [sessions]);

  return (
    <main className="flex-1 overflow-auto p-6 hide-scrollbar bg-background">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Header section */}
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl font-bold tracking-tight">{t("capturePage.title")}</h1>
              <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                {isTauriAvailable() ? "Desktop Proxy" : "Web Proxy"}
              </span>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              {t("capturePage.description")} HTTP en temps réel pour générer des tests, specs et
              mocks.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={refresh}
              disabled={busy}
              className="gap-1.5 text-xs"
            >
              <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
              {t("capturePage.refresh")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={clearAll}
              disabled={busy || sessions.length === 0}
              className="gap-1.5 text-xs text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
              {t("capturePage.clear")}
            </Button>
          </div>
        </header>

        {/* Info banner */}
        {!isTauriAvailable() && (
          <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 p-3.5 text-sm text-sky-700 dark:text-sky-400 flex items-start gap-3 shadow-xs">
            <Network className="size-5 shrink-0 mt-0.5 text-sky-500" />
            <div>
              <strong className="font-semibold">{t("capturePage.browserMode")}</strong> : Le proxy
              intercepte les requêtes exécutées au sein de Reqly (passant par{" "}
              <code className="text-xs font-mono bg-sky-500/20 px-1 py-0.5 rounded">
                /api/proxy
              </code>
              ). Pour capturer le trafic de n'importe quelle application externe ou smartphone,
              utilisez l'application Desktop.
            </div>
          </div>
        )}

        {/* Metrics Summary Bar (visible when sessions > 0) */}
        {sessions.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-lg border bg-card p-3.5 shadow-xs flex items-center gap-3">
              <div className="rounded-md bg-primary/10 p-2 text-primary">
                <Activity className="size-4" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">
                  {t("capturePage.captures")}
                </p>
                <p className="text-lg font-bold tracking-tight">{sessions.length}</p>
              </div>
            </div>

            <div className="rounded-lg border bg-card p-3.5 shadow-xs flex items-center gap-3">
              <div className="rounded-md bg-sky-500/10 p-2 text-sky-500">
                <Globe className="size-4" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Hôtes distincts</p>
                <p className="text-lg font-bold tracking-tight">{hostsCount}</p>
              </div>
            </div>

            <div className="rounded-lg border bg-card p-3.5 shadow-xs flex items-center gap-3">
              <div className="rounded-md bg-emerald-500/10 p-2 text-emerald-500">
                <Layers className="size-4" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Méthodes</p>
                <div className="flex items-center gap-1 mt-0.5">
                  {uniqueMethods.slice(0, 3).map((m) => (
                    <span
                      key={m}
                      className={cn(
                        "rounded px-1 py-0.2 text-[10px] font-bold border",
                        methodColor(m),
                      )}
                    >
                      {m}
                    </span>
                  ))}
                  {uniqueMethods.length > 3 && (
                    <span className="text-[10px] text-muted-foreground">
                      +{uniqueMethods.length - 3}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-lg border bg-card p-3.5 shadow-xs flex items-center gap-3">
              <div className="rounded-md bg-amber-500/10 p-2 text-amber-500">
                <Database className="size-4" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">
                  {t("capturePage.persistence")}
                </p>
                <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 mt-1 flex items-center gap-1">
                  <CheckCircle2 className="size-3" /> {t("capturePage.diskDb")}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Proxy Session Card */}
        <Card className="shadow-xs">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Network className="size-4 text-muted-foreground" />
                  {t("capturePage.sessionControl")}
                </CardTitle>
                <CardDescription className="text-xs">
                  {isTauriAvailable() ? (
                    <>
                      Ecoute sur <code className="text-xs font-mono">127.0.0.1:{port}</code> et
                      relaye le trafic vers l'hôte cible.
                    </>
                  ) : (
                    <>
                      Intercepte le trafic transitant par{" "}
                      <code className="text-xs font-mono">/api/proxy</code>.
                    </>
                  )}
                </CardDescription>
              </div>
              {running ? (
                <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                  {t("capturePage.listeningActive")}
                </span>
              ) : (
                <span className="flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                  {t("capturePage.proxyStopped")}
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {isTauriAvailable() && (
                <>
                  <div className="flex items-center gap-1.5">
                    <label
                      className="text-xs font-semibold text-muted-foreground"
                      htmlFor="capture-port"
                    >
                      Port
                    </label>
                    <input
                      id="capture-port"
                      type="number"
                      value={port}
                      min={1024}
                      max={65535}
                      disabled={running}
                      onChange={(e) => setPort(Number(e.target.value))}
                      className="w-20 rounded-md border border-input bg-background px-2 py-1 text-xs font-mono tabular-nums shadow-xs"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    {PRESET_PORTS.map((p) => (
                      <button
                        key={p}
                        type="button"
                        disabled={running}
                        onClick={() => setPort(p)}
                        className={cn(
                          "rounded px-2 py-1 text-xs font-mono transition-colors border",
                          port === p
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-muted text-muted-foreground hover:bg-muted/80 border-transparent",
                        )}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <div className="flex items-center gap-2 ml-auto">
                {!running ? (
                  <Button
                    size="sm"
                    onClick={startProxy}
                    disabled={busy}
                    className="gap-1.5 text-xs font-medium"
                  >
                    {busy ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Play className="size-3.5 fill-current" />
                    )}
                    {t("capturePage.startProxy")}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={stopProxy}
                    disabled={busy}
                    className="gap-1.5 text-xs font-medium"
                  >
                    {busy ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Square className="size-3.5 fill-current" />
                    )}
                    {t("capturePage.stopProxy")}
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Captured Requests Table / Empty State */}
        {sessions.length > 0 ? (
          <Card className="shadow-xs">
            <CardHeader className="pb-3 border-b">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="size-4 text-muted-foreground" />
                  {t("capturePage.trafficList")}
                </CardTitle>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder={t("capturePage.searchUrl")}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="h-8 w-52 rounded-md border border-input bg-background pl-8 pr-2 text-xs shadow-xs"
                    />
                  </div>
                  <select
                    value={methodFilter ?? ""}
                    onChange={(e) => setMethodFilter(e.target.value || null)}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs shadow-xs"
                  >
                    <option value="">{t("capturePage.allMethods")}</option>
                    {uniqueMethods.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant={groupByHost ? "default" : "outline"}
                    size="sm"
                    className="h-8 gap-1.5 text-xs"
                    onClick={() => setGroupByHost(!groupByHost)}
                  >
                    <Globe className="size-3.5" />
                    {t("capturePage.group")}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {grouped ? (
                <div className="divide-y">
                  {[...grouped.entries()].map(([host, items]) => (
                    <div key={host}>
                      <div className="flex items-center gap-2 bg-muted/40 px-4 py-1.5 text-xs font-semibold text-muted-foreground border-y border-border/50">
                        <Globe className="size-3 text-sky-500" />
                        {host}
                        <span className="ml-auto rounded-full bg-muted px-2 py-0.2 text-[10px]">
                          {items.length}
                        </span>
                      </div>
                      <ul className="divide-y">
                        {items.map((s, idx) => (
                          <RequestRow
                            key={s.id}
                            s={s}
                            status={statusById[s.id]}
                            index={idx}
                            onClick={() => openDetail(s.id)}
                          />
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : (
                <ul className="divide-y">
                  {filtered.map((s, idx) => (
                    <RequestRow
                      key={s.id}
                      s={s}
                      status={statusById[s.id]}
                      index={idx}
                      onClick={() => openDetail(s.id)}
                    />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card className="border-dashed p-8 text-center shadow-xs">
            <div className="mx-auto flex max-w-sm flex-col items-center justify-center space-y-3">
              <div className="rounded-full bg-primary/10 p-4 text-primary">
                <Network className="size-8" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold tracking-tight">
                  {t("capturePage.awaitingTraffic")}
                </h3>
                <p className="text-xs text-muted-foreground">
                  Start the proxy above and send HTTP requests to record sessions, infer schemas,
                  and generate test suites.
                </p>
              </div>
              {!running && (
                <Button size="sm" onClick={startProxy} disabled={busy} className="gap-2 mt-2">
                  <Play className="size-3.5 fill-current" />
                  {t("capturePage.startCapture")}
                </Button>
              )}
            </div>
          </Card>
        )}

        {/* Action Bar (Generator & Exporters) */}
        {sessions.length > 0 && (
          <div className="rounded-xl border bg-card p-4 shadow-xs flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-amber-500" />
              <span className="text-xs font-semibold text-foreground">
                {t("capturePage.generatorExporters")}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label
                className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer select-none mr-1"
                title="Masque les en-têtes sensibles (Authorization, cookies, tokens…) dans les fichiers exportés"
              >
                <input
                  type="checkbox"
                  checked={redactExports}
                  onChange={(e) => setRedactExports(e.target.checked)}
                  className="size-3.5 accent-primary"
                />
                {t("capturePage.redactExports")}
              </label>
              <Button
                onClick={generate}
                disabled={busy || sessions.length === 0}
                size="sm"
                className="gap-2 text-xs font-semibold shadow-xs"
              >
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Wand2 className="size-3.5" />
                )}
                {t("capturePage.generateSuite")}
              </Button>
              <Button
                onClick={handleExportHar}
                disabled={busy || sessions.length === 0}
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs shadow-xs"
              >
                <Download className="size-3.5" />
                {t("capturePage.exportHar")}
              </Button>
              <Button
                onClick={handleExportOpenApi}
                disabled={busy || sessions.length === 0}
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs shadow-xs"
              >
                <FileJson className="size-3.5 text-sky-500" />
                {t("capturePage.exportOpenApi")}
              </Button>
              <Button
                onClick={handleExportMocks}
                disabled={busy || sessions.length === 0}
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs shadow-xs"
              >
                <Database className="size-3.5 text-emerald-500" />
                {t("capturePage.exportMocks")}
              </Button>
            </div>
          </div>
        )}

        {droppedCount > 0 && (
          <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5 text-xs text-warning flex items-center gap-2">
            <AlertTriangle className="size-3.5 shrink-0" />
            <span>
              {droppedCount} requête{droppedCount > 1 ? "s" : ""} non capturée
              {droppedCount > 1 ? "s" : ""} (limite atteinte) : patientez une heure avant de
              reprendre la capture.
            </span>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive font-medium shadow-xs flex flex-wrap items-center justify-between gap-2">
            <span>{error}</span>
            {isTauriAvailable() && isPortError(error) && (
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-xs font-normal opacity-80">
                  {t("capturePage.changePort")}
                </span>
                {PRESET_PORTS.filter((p) => p !== port)
                  .slice(0, 3)
                  .map((p) => (
                    <Button
                      key={p}
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-[11px] font-mono bg-background"
                      onClick={() => {
                        setPort(p);
                        setError(null);
                      }}
                    >
                      Port {p}
                    </Button>
                  ))}
              </div>
            )}
          </div>
        )}

        {/* Collection Preview Card */}
        {bundle && (
          <Card className="shadow-xs border-emerald-500/30 dark:border-emerald-800">
            <CardHeader className="pb-3 border-b bg-emerald-500/5">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="size-4" />
                    {t("capturePage.bundlePreview")}
                  </CardTitle>
                  <CardDescription className="text-xs">
                    {t("capturePage.renameSave")}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <div className="flex items-center gap-2">
                <label
                  className="text-xs font-semibold shrink-0 text-muted-foreground"
                  htmlFor="collection-name"
                >
                  {t("capturePage.collectionName")}
                </label>
                <input
                  id="collection-name"
                  value={collectionName}
                  onChange={(e) => setCollectionName(e.target.value)}
                  className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium shadow-xs"
                />
              </div>
              <div className="space-y-2 max-h-64 overflow-auto pr-1">
                {bundle.collections[0].requests.map((req, i) => (
                  <div key={i} className="rounded-md border p-3 text-xs bg-muted/20">
                    <div className="flex items-center gap-2 font-semibold">
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[10px] font-bold border",
                          methodColor(req.method),
                        )}
                      >
                        {req.method}
                      </span>
                      <span className="font-mono text-xs text-foreground/90 truncate">
                        {req.url}
                      </span>
                    </div>
                    {req.runnerAssertions.length > 0 && (
                      <ul className="mt-2 space-y-1 pl-1">
                        {req.runnerAssertions.map((a, j) => (
                          <li
                            key={j}
                            className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
                          >
                            <ChevronRight className="size-3 text-emerald-500 shrink-0" />
                            {describeAssertion(a)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-3 border-t pt-3">
                <Button onClick={save} disabled={!!savedName} size="sm" className="gap-1.5 text-xs">
                  {savedName ? (
                    <CheckCircle2 className="size-3.5" />
                  ) : (
                    t("capturePage.saveToWorkspace")
                  )}
                </Button>
                {savedName && (
                  <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                    Collection &quot;{savedName}&quot; saved!
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Tabbed Request Detail Drawer */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-xs"
          onClick={() => setSelected(null)}
        >
          <div
            className="w-full max-w-2xl border-l bg-background shadow-2xl flex flex-col h-full animate-in slide-in-from-right duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer Header */}
            <div className="flex items-center justify-between gap-3 border-b px-5 py-3.5 bg-muted/20">
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className={cn(
                    "rounded px-2 py-0.5 text-xs font-bold border shrink-0",
                    methodColor(selected.method),
                  )}
                >
                  {selected.method}
                </span>
                <span className="truncate font-mono text-xs font-semibold text-foreground">
                  {selected.url}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-destructive/70 hover:text-destructive"
                  onClick={async () => {
                    try {
                      const removed = await deleteCapturedSession(selected.id);
                      if (removed) {
                        setSessions((prev) => prev.filter((s) => s.id !== selected.id));
                        setStatusById((prev) => {
                          const next = { ...prev };
                          delete next[selected.id];
                          return next;
                        });
                        setSelected(null);
                      } else {
                        setError("Session introuvable : elle a peut-être déjà été supprimée.");
                      }
                    } catch (e) {
                      setError(formatErrorMessage(e));
                    }
                  }}
                  title={t("capturePage.deleteSession")}
                  aria-label={t("capturePage.deleteSession")}
                >
                  <Trash2 className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setSelected(null)}
                  className="size-7 shrink-0"
                >
                  <X className="size-4" />
                </Button>
              </div>
            </div>

            {/* Quick Actions Bar */}
            <div className="flex items-center justify-between border-b px-5 py-2.5 bg-card text-xs">
              <div className="flex items-center gap-2.5">
                <span
                  className={cn(
                    "rounded px-2 py-0.5 text-xs font-semibold border",
                    statusColor(selected.status),
                  )}
                >
                  {selected.status != null ? `HTTP ${selected.status}` : "Status -"}
                </span>
                {selected.durationMs != null && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground font-mono">
                    <Clock className="size-3 text-muted-foreground" />
                    {selected.durationMs}ms
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                <CopyButton text={selected.url} label={t("capturePage.copyUrl")} />
                <CopyButton text={capturedToCurl(selected)} label={t("capturePage.curl")} />
                <Button
                  variant="default"
                  size="sm"
                  className="h-7 text-xs gap-1.5"
                  onClick={() => handleReplayRequest(selected)}
                >
                  <Send className="size-3" />
                  {t("capturePage.replay")}
                </Button>
              </div>
            </div>

            {/* Tab Navigation */}
            <div className="flex border-b px-5 bg-muted/10 text-xs font-medium">
              <button
                type="button"
                onClick={() => setActiveDrawerTab("overview")}
                className={cn(
                  "px-3 py-2 border-b-2 transition-colors",
                  activeDrawerTab === "overview"
                    ? "border-primary text-primary font-semibold"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t("capturePage.overview")}
              </button>
              <button
                type="button"
                onClick={() => setActiveDrawerTab("headers")}
                className={cn(
                  "px-3 py-2 border-b-2 transition-colors",
                  activeDrawerTab === "headers"
                    ? "border-primary text-primary font-semibold"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t("capturePage.headers")} ({selected.headers?.length || 0})
              </button>
              <button
                type="button"
                onClick={() => setActiveDrawerTab("body")}
                className={cn(
                  "px-3 py-2 border-b-2 transition-colors",
                  activeDrawerTab === "body"
                    ? "border-primary text-primary font-semibold"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t("capturePage.bodyPayload")}
              </button>
              <button
                type="button"
                onClick={() => setActiveDrawerTab("curl")}
                className={cn(
                  "px-3 py-2 border-b-2 transition-colors flex items-center gap-1",
                  activeDrawerTab === "curl"
                    ? "border-primary text-primary font-semibold"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <Terminal className="size-3" />
                {t("capturePage.curl")}
              </button>
            </div>

            {/* Tab Content Area */}
            <div className="flex-1 overflow-auto p-5 space-y-5 text-xs">
              {activeDrawerTab === "overview" && (
                <div className="space-y-5">
                  <section className="rounded-lg border p-3.5 space-y-2.5 bg-muted/10">
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      {t("capturePage.requestDetails")}
                    </h4>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <span className="text-muted-foreground block">
                          {t("capturePage.method")}
                        </span>
                        <span className="font-mono font-bold">{selected.method}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block">
                          {t("capturePage.statusCode")}
                        </span>
                        <span className="font-mono font-bold">{selected.status ?? "N/A"}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block">
                          {t("capturePage.duration")}
                        </span>
                        <span className="font-mono">
                          {selected.durationMs ? `${selected.durationMs}ms` : "N/A"}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block">
                          {t("capturePage.timestamp")}
                        </span>
                        <span className="font-mono">{formatTime(selected.timestamp)}</span>
                      </div>
                    </div>
                    {selected.error && (
                      <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
                        <span className="font-semibold">{t("capturePage.transferError")}</span>{" "}
                        {selected.error}
                      </div>
                    )}
                  </section>

                  <section>
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t("capturePage.fullUrl")}
                    </h4>
                    <div className="rounded-md border bg-muted/30 p-2.5 font-mono break-all text-xs flex items-center justify-between gap-2">
                      <span>{selected.url}</span>
                      <CopyButton text={selected.url} label="Copy" />
                    </div>
                  </section>
                </div>
              )}

              {activeDrawerTab === "headers" && (
                <div className="space-y-5">
                  <section>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {t("capturePage.requestHeaders")} ({selected.headers?.length || 0})
                      </h4>
                      {selected.headers?.length > 0 && (
                        <CopyButton
                          text={selected.headers.map(([k, v]) => `${k}: ${v}`).join("\n")}
                          label={t("capturePage.copyAll")}
                        />
                      )}
                    </div>
                    <KeyValueList
                      pairs={selected.headers}
                      empty={t("capturePage.noRequestHeaders")}
                    />
                  </section>

                  <section>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {t("capturePage.responseHeaders")} ({selected.responseHeaders?.length ?? 0})
                      </h4>
                      {(selected.responseHeaders?.length ?? 0) > 0 && (
                        <CopyButton
                          text={(selected.responseHeaders ?? [])
                            .map(([k, v]) => `${k}: ${v}`)
                            .join("\n")}
                          label={t("capturePage.copyAll")}
                        />
                      )}
                    </div>
                    <KeyValueList
                      pairs={selected.responseHeaders ?? []}
                      empty={t("capturePage.noResponseHeaders")}
                    />
                  </section>
                </div>
              )}

              {activeDrawerTab === "body" && (
                <div className="space-y-5">
                  <section>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {t("capturePage.requestBodyPayload")}
                      </h4>
                      {selected.body && (
                        <CopyButton text={selected.body} label={t("capturePage.copyBody")} />
                      )}
                    </div>
                    <pre className="max-h-56 overflow-auto rounded-md border bg-muted/30 p-3 font-mono text-xs">
                      {selected.body ? (
                        prettyJson(selected.body)
                      ) : (
                        <span className="text-muted-foreground italic">
                          {t("capturePage.noRequestBody")}
                        </span>
                      )}
                    </pre>
                  </section>

                  <section>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {t("capturePage.responseBodyPayload")}
                      </h4>
                      {selected.responseBody && (
                        <CopyButton
                          text={selected.responseBody}
                          label={t("capturePage.copyBody")}
                        />
                      )}
                    </div>
                    <pre className="max-h-64 overflow-auto rounded-md border bg-muted/30 p-3 font-mono text-xs">
                      {selected.responseBody ? (
                        prettyJson(selected.responseBody)
                      ) : (
                        <span className="text-muted-foreground italic">
                          {t("capturePage.noResponseBody")}
                        </span>
                      )}
                    </pre>
                  </section>
                </div>
              )}

              {activeDrawerTab === "curl" && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                      <Terminal className="size-3.5 text-primary" />
                      {t("capturePage.curlCommand")}
                    </h4>
                    <CopyButton
                      text={capturedToCurl(selected)}
                      label={t("capturePage.copyCommand")}
                    />
                  </div>
                  <pre className="overflow-auto rounded-md border bg-slate-950 p-3.5 font-mono text-xs text-slate-100 dark:bg-slate-900 border-slate-800">
                    {capturedToCurl(selected)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function RequestRow({
  s,
  status,
  index,
  onClick,
}: {
  s: CapturedSummary;
  status: number | null;
  index: number;
  onClick: () => void;
}) {
  return (
    <li
      className="animate-in fade-in slide-in-from-bottom-1"
      style={{
        animationDuration: "250ms",
        animationDelay: `${Math.min(index * 15, 300)}ms`,
        animationFillMode: "both",
      }}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-xs hover:bg-muted/60 transition-colors group"
      >
        <span
          className={cn(
            "rounded px-2 py-0.5 text-[10px] font-bold border shrink-0",
            methodColor(s.method),
          )}
        >
          {s.method}
        </span>
        <span className="flex-1 truncate font-mono text-xs text-foreground/80 group-hover:text-foreground transition-colors">
          {s.url}
        </span>
        <span
          className={cn(
            "rounded px-2 py-0.5 text-[10px] font-semibold border shrink-0",
            statusColor(status),
          )}
        >
          {status != null ? status : "..."}
        </span>
        <span className="w-16 shrink-0 text-right text-[11px] text-muted-foreground font-mono tabular-nums">
          {formatTime(s.timestamp)}
        </span>
        <ChevronRight className="size-3.5 text-muted-foreground/40 shrink-0 group-hover:translate-x-0.5 transition-transform" />
      </button>
    </li>
  );
}

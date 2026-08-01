"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { cn } from "@/lib/utils";
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
  Filter,
  X,
  Network,
  ChevronRight,
  Clock,
  ArrowUpDown,
  Globe,
  LayoutGrid,
} from "lucide-react";
import { useRequestStore } from "@/hooks/use-request-store";
import {
  isTauriAvailable,
  listCapturedSessions,
  getCapturedSession,
  startCaptureProxy,
  stopCaptureProxy,
  clearCapturedSessions,
  type CapturedSummary,
  type CapturedRequest,
} from "@/lib/tauri";
import { generateCollectionFromCapture, type ExportBundle } from "@/lib/capture-to-test/generate";
import type { Assertion } from "@/lib/test-runner/types";

const PRESET_PORTS = [8080, 3000, 8888, 9090];

const METHOD_COLORS: Record<string, string> = {
  GET: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
  POST: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-400",
  PUT: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  PATCH: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-400",
  DELETE: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400",
};

function methodColor(method: string): string {
  return METHOD_COLORS[method.toUpperCase()] ?? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400";
}

function statusColor(status: number | null | undefined): string {
  if (status == null) return "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400";
  if (status >= 500) return "bg-destructive/15 text-destructive";
  if (status >= 400) return "bg-warning/15 text-warning";
  if (status >= 300) return "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400";
  if (status >= 200) return "bg-success/15 text-success";
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
    case "jsonPath": return `body.${a.path} ${a.operator}`;
    case "schema": return "response matches inferred JSON schema";
    case "responseTime": return `response time ${a.operator} ${a.valueMs}ms`;
    default: return "assertion";
  }
}

function toSummary(c: CapturedRequest): CapturedSummary {
  return { id: c.id, method: c.method, url: c.url, timestamp: c.timestamp };
}

function formatTime(ts: number): string {
  try { return new Date(ts).toLocaleTimeString(); }
  catch { return ""; }
}

function extractHost(url: string): string {
  try { return new URL(url).host; }
  catch { return url; }
}

function KeyValueList({ pairs, empty }: { pairs: Array<[string, string]>; empty: string }) {
  if (!pairs || pairs.length === 0) {
    return <p className="text-xs text-muted-foreground">{empty}</p>;
  }
  return (
    <ul className="divide-y rounded border text-xs">
      {pairs.map(([k, v], i) => (
        <li key={i} className="flex gap-2 px-2 py-1">
          <span className="font-medium text-muted-foreground shrink-0">{k}:</span>
          <span className="break-all font-mono text-foreground/80">{v}</span>
        </li>
      ))}
    </ul>
  );
}

export default function CapturePage() {
  const { addCollection, addRequestToCollection } = useRequestStore();

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

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const list = await listCapturedSessions();
      setSessions(list);
      setStatusById((prev) => {
        const next = { ...prev };
        for (const s of list) if (!(s.id in next)) next[s.id] = null;
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

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
          prev.map((x) => (x.id === c.id ? { ...x, timestamp: c.timestamp } : x))
        );
        setSelected((sel) => (sel && sel.id === c.id ? c : sel));
      }),
    ])
      .then((unsubFns) => { if (!cancelled) unsubs = unsubFns as Array<() => void>; })
      .catch(() => {});
    return () => { cancelled = true; unsubs.forEach((u) => u()); };
  }, []);

  const startProxy = async () => {
    setError(null); setBusy(true);
    try {
      await startCaptureProxy(port);
      setRunning(true); setSessions([]); setStatusById({}); setBundle(null); setSelected(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const stopProxy = async () => {
    setError(null); setBusy(true);
    try {
      await stopCaptureProxy(); setRunning(false); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const clearAll = async () => {
    setError(null); setBusy(true);
    try {
      await clearCapturedSessions(); setSessions([]); setStatusById({}); setSelected(null); setBundle(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const openDetail = async (id: string) => {
    setError(null);
    try { const full = await getCapturedSession(id); if (full) setSelected(full); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const generate = async () => {
    setError(null); setSavedName(null); setBusy(true);
    try {
      const list = await listCapturedSessions();
      setSessions(list);
      const detailed: CapturedRequest[] = [];
      for (const s of list) {
        const full = await getCapturedSession(s.id);
        if (full) detailed.push(full);
      }
      if (detailed.length === 0) {
        setError("No captured requests found. Start capture and send some traffic.");
        return;
      }
      const generated = generateCollectionFromCapture(detailed);
      setBundle(generated);
      setCollectionName(generated.collections[0].name);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const save = () => {
    if (!bundle) return;
    const col = bundle.collections[0];
    const newId = addCollection({
      name: collectionName.trim() || col.name,
      color: col.color, icon: col.icon, description: col.description,
    });
    for (const req of col.requests) addRequestToCollection(newId, req);
    setSavedName(collectionName.trim() || col.name);
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

  return (
    <main className="flex-1 overflow-auto p-6 hide-scrollbar">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Traffic Capture</h1>
            <p className="text-sm text-muted-foreground">
              Intercept HTTP traffic through the Reqly proxy, then generate a testable collection.
            </p>
          </div>
        </header>

        {!isTauriAvailable() && (
          <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
            Capture requires the Reqly desktop app (Tauri). Collection generation and saving are still available.
          </div>
        )}

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Network className="size-4 text-muted-foreground" />
                  Proxy Session
                </CardTitle>
                <CardDescription>
                  Listens on <code className="text-xs">127.0.0.1:{port}</code> and relays to the target host.
                </CardDescription>
              </div>
              {running && (
                <span className="flex items-center gap-1.5 rounded-full bg-success/15 px-3 py-1 text-xs font-medium text-success">
                  <span className="size-1.5 rounded-full bg-success animate-pulse" />
                  Listening
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5">
                <label className="text-sm font-medium" htmlFor="capture-port">Port</label>
                <input
                  id="capture-port"
                  type="number"
                  value={port}
                  min={1024} max={65535}
                  disabled={running}
                  onChange={(e) => setPort(Number(e.target.value))}
                  className="w-24 rounded-md border border-input bg-background px-2 py-1.5 text-sm tabular-nums"
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
                      "rounded px-2 py-1 text-xs font-mono transition-colors",
                      port === p
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/80",
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1 ml-auto">
                {!running ? (
                  <Button size="sm" onClick={startProxy} disabled={busy} className="gap-1.5">
                    {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                    Start
                  </Button>
                ) : (
                  <Button size="sm" variant="destructive" onClick={stopProxy} disabled={busy} className="gap-1.5">
                    {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Square className="size-3.5" />}
                    Stop
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={refresh} disabled={busy} className="gap-1.5">
                  <RefreshCw className="size-3.5" />
                  Refresh
                </Button>
                <Button size="sm" variant="ghost" onClick={clearAll} disabled={busy || sessions.length === 0} className="gap-1.5">
                  <Trash2 className="size-3.5" />
                  Clear
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Database className="size-3" />
              <span>{sessions.length} request{sessions.length !== 1 ? "s" : ""} captured</span>
              {sessions.length > 0 && <span className="text-muted-foreground/50">·</span>}
              {sessions.length > 0 && (
                <span className="text-success">Saved to disk (persist across restarts)</span>
              )}
            </div>
          </CardContent>
        </Card>

        {sessions.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <CardTitle className="text-base">Captured Requests</CardTitle>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Search URL..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="h-8 w-48 rounded-md border border-input bg-background pl-7 pr-2 text-xs"
                    />
                  </div>
                  <select
                    value={methodFilter ?? ""}
                    onChange={(e) => setMethodFilter(e.target.value || null)}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  >
                    <option value="">All methods</option>
                    {uniqueMethods.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  <Button
                    variant={groupByHost ? "default" : "outline"}
                    size="sm"
                    className="h-8 gap-1.5 text-xs"
                    onClick={() => setGroupByHost(!groupByHost)}
                  >
                    <Globe className="size-3.5" />
                    Group
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {grouped ? (
                <div className="divide-y">
                  {[...grouped.entries()].map(([host, items]) => (
                    <div key={host}>
                      <div className="flex items-center gap-2 bg-muted/50 px-4 py-1.5 text-xs font-medium text-muted-foreground">
                        <Globe className="size-3" />
                        {host}
                        <span className="ml-auto">{items.length}</span>
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
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={generate} disabled={busy || sessions.length === 0} className="gap-2">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
            Generate Collection from Capture
          </Button>
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {bundle && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Collection Preview</CardTitle>
              <CardDescription>Rename and save the collection to your workspace.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium shrink-0" htmlFor="collection-name">Name</label>
                <input
                  id="collection-name"
                  value={collectionName}
                  onChange={(e) => setCollectionName(e.target.value)}
                  className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                />
              </div>
              <div className="space-y-2">
                {bundle.collections[0].requests.map((req, i) => (
                  <div key={i} className="rounded-lg border p-3 text-sm">
                    <div className="flex items-center gap-2 font-medium">
                      <span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold", methodColor(req.method))}>
                        {req.method}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground truncate">{req.url}</span>
                    </div>
                    {req.runnerAssertions.length > 0 && (
                      <ul className="mt-2 space-y-0.5">
                        {req.runnerAssertions.map((a, j) => (
                          <li key={j} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <ChevronRight className="size-3 shrink-0" />
                            {describeAssertion(a)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={save} disabled={!!savedName} className="gap-1.5">
                  {savedName ? <CheckCircle2 className="size-4" /> : "Save Collection"}
                </Button>
                {savedName && (
                  <span className="text-sm text-success">Collection &quot;{savedName}&quot; saved.</span>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {selected && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/30"
          onClick={() => setSelected(null)}
        >
          <div
            className="w-full max-w-xl animate-slide-left border-l bg-background shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between gap-2 border-b px-5 py-4">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold shrink-0", methodColor(selected.method))}>
                    {selected.method}
                  </span>
                  <span className="truncate font-mono text-sm">{selected.url}</span>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setSelected(null)} className="shrink-0">
                  <X className="size-4" />
                </Button>
              </div>

              <div className="flex items-center gap-3 border-b px-5 py-3 text-sm">
                <span className={cn("rounded px-2 py-0.5 text-xs font-semibold", statusColor(selected.status))}>
                  {selected.status != null ? `HTTP ${selected.status}` : "Status —"}
                </span>
                {selected.durationMs != null && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="size-3" />
                    {selected.durationMs}ms
                  </span>
                )}
                {selected.error && (
                  <span className="text-xs text-destructive">Error: {selected.error}</span>
                )}
              </div>

              <div className="flex-1 overflow-auto p-5 space-y-6 text-sm">
                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Request Headers</h3>
                  <KeyValueList pairs={selected.headers} empty="No headers" />
                </section>
                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Request Body</h3>
                  <pre className="max-h-48 overflow-auto rounded-lg border bg-muted/30 p-3 font-mono text-xs">
                    {selected.body ?? <span className="text-muted-foreground italic">No body</span>}
                  </pre>
                </section>
                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Response Headers</h3>
                  <KeyValueList pairs={selected.responseHeaders ?? []} empty="No headers" />
                </section>
                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Response Body</h3>
                  <pre className="max-h-64 overflow-auto rounded-lg border bg-muted/30 p-3 font-mono text-xs">
                    {selected.responseBody ?? <span className="text-muted-foreground italic">No body</span>}
                  </pre>
                </section>
              </div>
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
      style={{ animationDuration: "300ms", animationDelay: `${Math.min(index * 20, 500)}ms`, animationFillMode: "both" }}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-muted/60 transition-colors"
      >
        <span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold shrink-0", methodColor(s.method))}>
          {s.method}
        </span>
        <span className="flex-1 truncate font-mono text-xs text-foreground/80">{s.url}</span>
        <span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold shrink-0", statusColor(status))}>
          {status != null ? status : "..."}
        </span>
        <span className="w-16 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
          {formatTime(s.timestamp)}
        </span>
        <ChevronRight className="size-3.5 text-muted-foreground/40 shrink-0" />
      </button>
    </li>
  );
}

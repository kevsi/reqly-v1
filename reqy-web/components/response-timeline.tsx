"use client";

import { memo, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { cn, formatBytes } from "@/lib/utils";
import type { ResponseTimings } from "@/lib/types";
import { AlertTriangle, ArrowLeftRight, Link2, Unlink } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface ResponseTimelineProps {
  timings: Partial<ResponseTimings>;
}

// ── Seuils par défaut (ms) ────────────────────────────────────────────────
// TTFB > 500ms = lent, DNS > 50ms = résolution lente, etc.
const DEFAULT_THRESHOLDS: Record<string, number> = {
  dns: 50,
  tcp: 100,
  tls: 200,
  upload: 300,
  wait: 500,
  download: 1000,
};

const PHASE_COLORS = {
  dns: "bg-blue-500",
  tcp: "bg-violet-500",
  tls: "bg-yellow-500",
  upload: "bg-pink-500",
  wait: "bg-orange-500",
  download: "bg-emerald-500",
} as const;

const PHASE_LABELS: Record<string, string> = {
  dns: "DNS",
  tcp: "TCP",
  tls: "TLS",
  upload: "Upload",
  wait: "Wait",
  download: "Download",
};

function formatMs(ms: number): string {
  if (ms < 1) return "<1";
  return String(Math.round(ms));
}

interface PhaseSegment {
  key: string;
  ms: number;
  color: string;
  label: string;
  overThreshold: boolean;
}

export const ResponseTimeline = memo(function ResponseTimeline({ timings }: ResponseTimelineProps) {
  const { t } = useTranslation();
  const [prevTimings, setPrevTimings] = useState<Partial<ResponseTimings> | null>(null);
  const [showDiff, setShowDiff] = useState(false);

  const {
    dnsMs = 0,
    connectMs = 0,
    tlsMs = 0,
    ttfbMs = 0,
    transferMs: transferRaw,
    totalMs = 0,
    transport,
    uploadMs = 0,
    requestBytes = 0,
    responseBytes = 0,
    connectionReused = false,
  } = timings;

  // Calcul des phases (indépendantes, sans chevauchement)
  const tcpMs = Math.max(0, connectMs - dnsMs);
  const tlsPhase = Math.max(0, tlsMs);
  // Wait = temps serveur avant 1er octet (exclut DNS/TCP/TLS)
  const waitMs = Math.max(0, ttfbMs - connectMs - tlsPhase);
  const downloadMs = transferRaw ?? Math.max(0, totalMs - ttfbMs);

  // Construction des segments
  const buildSegments = (th: Record<string, number>): PhaseSegment[] => {
    const raw: { key: string; ms: number }[] = [
      { key: "dns", ms: dnsMs },
      { key: "tcp", ms: tcpMs },
      { key: "tls", ms: tlsPhase },
      { key: "upload", ms: uploadMs },
      { key: "wait", ms: waitMs },
      { key: "download", ms: downloadMs },
    ];
    return raw
      .filter((s) => s.ms > 0)
      .map((s) => ({
        ...s,
        color: PHASE_COLORS[s.key as keyof typeof PHASE_COLORS],
        label: PHASE_LABELS[s.key],
        overThreshold: s.ms > (th[s.key] ?? Infinity),
      }));
  };

  const segments = buildSegments(DEFAULT_THRESHOLDS);
  const sumSegments = segments.reduce((a, s) => a + s.ms, 0);
  const hasOverflow = sumSegments > totalMs * 1.05;
  // Probe (DNS/TCP/TLS) est une sonde parallèle au fetch — somme peut dépasser Total
  const probeKeys = new Set(["dns", "tcp", "tls"]);
  const probeSum = segments.filter((s) => probeKeys.has(s.key)).reduce((a, s) => a + s.ms, 0);
  const fetchSum = segments.filter((s) => !probeKeys.has(s.key)).reduce((a, s) => a + s.ms, 0);

  // Phase dominante (> 50% du total)
  const dominant = segments.find((s) => totalMs > 0 && s.ms / totalMs > 0.5);

  // Comparaison avec la requête précédente
  const prevSegments = prevTimings ? buildSegments(DEFAULT_THRESHOLDS) : null;

  // Basculer l'affichage comparatif et stocker les timings actuels
  const toggleDiff = useCallback(() => {
    setShowDiff((v) => {
      const next = !v;
      if (next) {
        setPrevTimings(timings);
      }
      return next;
    });
  }, [timings]);

  if (segments.length === 0 || totalMs === 0) {
    return null;
  }

  const probeSegments = segments.filter((s) => probeKeys.has(s.key));
  const fetchSegments = segments.filter((s) => !probeKeys.has(s.key));

  return (
    <div className="px-4 py-3 border-b border-border/50 space-y-2">
      {/* ── Barres segmentées ──────────────────────────────────────── */}
      {hasOverflow ? (
        <>
          {/* Sonde */}
          <div className="space-y-1">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              Sonde <span className="font-mono normal-case tracking-normal">DNS+TCP+TLS = {probeSum}ms</span>
              <span className="opacity-60">·</span>
              <span className="text-amber-600 dark:text-amber-400">parallèle au fetch</span>
            </p>
            <div className="flex h-2 rounded-full bg-muted-foreground/10 overflow-hidden">
              {probeSegments.map((s) => (
                <Tooltip key={`probe-${s.key}`}>
                  <TooltipTrigger asChild>
                    <div
                      className={cn("h-full transition-all duration-300 cursor-help", s.color, "opacity-70")}
                      style={{ width: `${(s.ms / Math.max(1, probeSum)) * 100}%` }}
                    />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[260px]">
                    <p className="font-semibold">
                      {s.label} (sonde): {formatMs(s.ms)} ms ({Math.round((s.ms / probeSum) * 100)}% sonde,{" "}
                      {Math.round((s.ms / totalMs) * 100)}% Total)
                    </p>
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          </div>
          {/* Fetch */}
          <div className="space-y-1">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              Fetch <span className="font-mono normal-case tracking-normal">Wait+Download = {fetchSum}ms / Total {totalMs}ms</span>
            </p>
            <div className="flex h-2 rounded-full bg-muted-foreground/10 overflow-hidden">
              {fetchSegments.length > 0 ? (
                fetchSegments.map((s) => (
                  <Tooltip key={`fetch-${s.key}`}>
                    <TooltipTrigger asChild>
                      <div
                        className={cn("h-full transition-all duration-300 cursor-help", s.color)}
                        style={{ width: `${(s.ms / Math.max(1, fetchSum || totalMs)) * 100}%` }}
                      />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[260px]">
                      <p className="font-semibold">
                        {s.label}: {formatMs(s.ms)} ms ({Math.round((s.ms / totalMs) * 100)}% Total)
                      </p>
                    </TooltipContent>
                  </Tooltip>
                ))
              ) : (
                <div className="h-full w-full bg-muted-foreground/5 flex items-center justify-center text-[10px] text-muted-foreground">
                  Wait 0ms — réponse quasi instantanée
                </div>
              )}
            </div>
          </div>
          <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-2.5 py-1.5 space-y-1">
            <p className="text-[11px] font-medium text-amber-700 dark:text-amber-400 flex items-center gap-1">
              <AlertTriangle className="size-3" />
              Sonde parallèle — ne s'additionne pas au Total fetch
            </p>
            <p className="text-[11px] font-mono text-muted-foreground">
              Sonde: DNS {dnsMs} + TCP {tcpMs} + TLS {tlsPhase} = {probeSum}ms{" "}
              <span className="opacity-60">·</span> Fetch: Wait {waitMs} + Download {downloadMs} {uploadMs > 0 ? `+ Upload ${uploadMs}` : ""} = {fetchSum}ms{" "}
              <span className="opacity-60">·</span> Total fetch {totalMs}ms
            </p>
          </div>
        </>
      ) : (
        <div className="flex h-2 rounded-full bg-muted-foreground/10 overflow-hidden">
          {segments.map((s) => (
            <Tooltip key={s.key}>
              <TooltipTrigger asChild>
                <div
                  className={cn("h-full transition-all duration-300 cursor-help", s.color)}
                  style={{ width: `${(s.ms / totalMs) * 100}%` }}
                />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[260px]">
                <div className="space-y-1">
                  <p className="font-semibold">
                    {s.label}: {formatMs(s.ms)} ms ({Math.round((s.ms / totalMs) * 100)}% du Total)
                  </p>
                  <p className="text-[11px] opacity-80">
                    Seuil: {DEFAULT_THRESHOLDS[s.key] ?? "—"} ms —{" "}
                    {s.overThreshold ? "dépassé" : "ok"}
                  </p>
                  {s.overThreshold && <p className="text-amber-300 text-[11px]">⚠ Lent pour cette phase</p>}
                </div>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      )}

      {/* ── Légendes avec ms + seuils ────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {segments.map((s) => (
          <Tooltip key={s.key}>
            <TooltipTrigger asChild>
              <div
                className={cn(
                  "flex items-center gap-1 text-xs font-mono cursor-help rounded px-1 py-0.5",
                  dominant?.key === s.key
                    ? "text-foreground font-semibold bg-muted/20"
                    : "text-muted-foreground hover:bg-muted/10",
                  s.overThreshold && "ring-1 ring-amber-500/20 bg-amber-500/5",
                )}
              >
                {/* Pastille couleur */}
                <span className={cn("inline-block size-2 rounded-full", s.color)} />

                {/* Label */}
                <span>{s.label}</span>
                {hasOverflow && probeKeys.has(s.key) && (
                  <span className="text-[9px] px-1 py-0 rounded bg-amber-500/10 text-amber-600 border border-amber-500/20 font-sans">sonde</span>
                )}

                {/* Durée */}
                <span className="tabular-nums">{formatMs(s.ms)}</span>
                <span className="text-muted-foreground/60">ms</span>

                {/* Alerte seuil */}
                {s.overThreshold && <AlertTriangle className="size-2.5 text-amber-500" />}

                {/* Diff vs précédent */}
                {showDiff && prevSegments && (
                  <DiffBadge
                    current={s.ms}
                    previous={prevSegments.find((p) => p.key === s.key)?.ms ?? 0}
                  />
                )}
              </div>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p className="text-xs">
                {s.label}: {formatMs(s.ms)} ms — seuil {DEFAULT_THRESHOLDS[s.key]} ms
              </p>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>

      {/* ── Barre info : total · transport · connection reuse · bytes ── */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {/* Total */}
        <div className="flex items-center gap-1 font-mono text-foreground/70">
          <span>{t("response.timelineTotal")}</span>
          <span className="tabular-nums font-semibold">{formatMs(totalMs)}</span>
          <span className="text-muted-foreground/60">ms</span>
        </div>

        <span className="text-muted-foreground/30">·</span>

        {/* Transport */}
        {transport && (
          <span className="text-muted-foreground/50">
            {transport === "proxy" ? "via proxy" : "natif"}
          </span>
        )}

        {/* Connection reuse */}
        <span className="flex items-center gap-1">
          {connectionReused ? (
            <>
              <Link2 className="size-3 text-emerald-500" />
              <span className="text-emerald-600 dark:text-emerald-400">keep-alive</span>
            </>
          ) : (
            <>
              <Unlink className="size-3 text-muted-foreground/40" />
              <span>nouvelle connexion</span>
            </>
          )}
        </span>

        <span className="text-muted-foreground/30">·</span>

        {/* Bytes */}
        {requestBytes > 0 && (
          <span className="tabular-nums">↑ {formatBytes(requestBytes)}</span>
        )}
        {responseBytes > 0 && (
          <span className="tabular-nums">↓ {formatBytes(responseBytes)}</span>
        )}

        {/* Bouton comparaison */}
        {prevTimings && (
          <>
            <span className="text-muted-foreground/30">·</span>
            <button
              onClick={toggleDiff}
              className={cn(
                "flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-colors",
                showDiff
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground/50 hover:text-muted-foreground",
              )}
            >
              <ArrowLeftRight className="size-2.5" />
              Diff
            </button>
          </>
        )}
      </div>
    </div>
  );
});

// ── Badge de différence entre deux timings ────────────────────────────────
function DiffBadge({ current, previous }: { current: number; previous: number }) {
  if (previous === 0) return null;
  const diff = current - previous;
  const pct = Math.round((diff / previous) * 100);
  if (diff === 0) return null;

  const isSlower = diff > 0;
  return (
    <span
      className={cn(
        "text-[10px] tabular-nums font-mono px-1 py-0 rounded",
        isSlower ? "text-red-500 bg-red-500/10" : "text-emerald-500 bg-emerald-500/10",
      )}
    >
      {isSlower ? "+" : ""}{pct}%
    </span>
  );
}

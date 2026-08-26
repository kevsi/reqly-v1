"use client";

import { memo, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { cn, formatBytes } from "@/lib/utils";
import type { ResponseTimings } from "@/lib/types";
import { AlertTriangle, ArrowLeftRight, Link2, Unlink } from "lucide-react";

interface ResponseTimelineProps {
  timings: ResponseTimings;
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
  const [prevTimings, setPrevTimings] = useState<ResponseTimings | null>(null);
  const [showDiff, setShowDiff] = useState(false);

  const {
    dnsMs = 0,
    connectMs = 0,
    tlsMs = 0,
    ttfbMs = 0,
    transferMs: transferRaw,
    totalMs,
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

  return (
    <div className="px-4 py-3 border-b border-border/50 space-y-2">
      {/* ── Barre segmentée ──────────────────────────────────────── */}
      <div className="flex h-2 rounded-full bg-muted-foreground/10 overflow-hidden">
        {segments.map((s) => (
          <div
            key={s.key}
            className={cn("h-full transition-all duration-300", s.color)}
            style={{ width: `${(s.ms / totalMs) * 100}%` }}
            title={`${s.label}: ${formatMs(s.ms)} ms`}
          />
        ))}
      </div>

      {/* ── Légendes avec ms + seuils ────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {segments.map((s) => (
          <div
            key={s.key}
            className={cn(
              "flex items-center gap-1 text-xs font-mono",
              dominant?.key === s.key
                ? "text-foreground font-semibold"
                : "text-muted-foreground",
            )}
          >
            {/* Pastille couleur */}
            <span className={cn("inline-block size-2 rounded-full", s.color)} />

            {/* Label */}
            <span>{s.label}</span>

            {/* Durée */}
            <span className="tabular-nums">{formatMs(s.ms)}</span>
            <span className="text-muted-foreground/60">ms</span>

            {/* Alerte seuil */}
            {s.overThreshold && (
              <AlertTriangle className="size-2.5 text-amber-500" />
            )}

            {/* Diff vs précédent */}
            {showDiff && prevSegments && (
              <DiffBadge
                current={s.ms}
                previous={prevSegments.find((p) => p.key === s.key)?.ms ?? 0}
              />
            )}
          </div>
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

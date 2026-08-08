"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";

const json = `{
  "users": [
    {
      "id": 1,
      "name": "Ada Lovelace",
      "email": "ada@reqly.dev",
      "role": "admin"
    },
    {
      "id": 2,
      "name": "Grace Hopper",
      "email": "grace@reqly.dev",
      "role": "developer"
    }
  ],
  "total": 2
}`;

type Phase = "idle" | "sending" | "done";

/** Visuel décoratif : masqué aux lecteurs d'écran, aucun élément focusable. */
export function EditorMockup() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [ms, setMs] = useState<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);
  const DURATION = 1400; // ms

  // Lance l'animation au montage après un court délai
  useEffect(() => {
    const t = setTimeout(() => runSend(), 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function runSend() {
    setPhase("sending");
    setProgress(0);
    startRef.current = null;

    const animate = (ts: number) => {
      if (!startRef.current) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const p = Math.min(elapsed / DURATION, 1);
      // ease-in-out cubic
      const eased = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      setProgress(Math.round(eased * 100));
      if (p < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        setPhase("done");
        setMs(Math.round(180 + Math.random() * 120));
        // Rejoue après 4 s
        setTimeout(() => {
          setPhase("idle");
          setProgress(0);
          setTimeout(() => runSend(), 600);
        }, 4000);
      }
    };
    rafRef.current = requestAnimationFrame(animate);
  }

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className="overflow-hidden rounded-xl border border-ink-700 bg-ink-950/95"
    >
      {/* Barre de fenêtre */}
      <div className="flex items-center gap-2 border-b border-ink-700 bg-ink-850 px-4 py-3">
        <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
        <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
        <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        <span className="ml-3 hidden text-xs text-zinc-500 sm:block">reqly — localhost:3000</span>
      </div>

      {/* Onglets */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-ink-700 bg-ink-850 px-3 pt-2 hide-scrollbar">
        {[
          { method: "GET", label: "api/users", active: true },
          { method: "POST", label: "api/login" },
          { method: "GQL", label: "graphql/playground" },
        ].map((t, i) => (
          <div
            key={i}
            className={`flex shrink-0 items-center gap-2 rounded-t-lg px-3 py-2 text-xs font-medium ${
              t.active
                ? "border border-b-0 border-ink-600 bg-ink-900 text-zinc-200"
                : "text-zinc-500"
            }`}
          >
            <span
              className={`font-mono text-[10px] font-bold ${
                t.method === "GET"
                  ? "text-mint-400"
                  : t.method === "POST"
                    ? "text-amber-400"
                    : "text-fuchsia-400"
              }`}
            >
              {t.method}
            </span>
            {t.label}
          </div>
        ))}
        <div className="ml-auto mb-1 mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-600 hover:text-zinc-300">
          +
        </div>
      </div>

      {/* Barre d'URL */}
      <div className="flex items-center gap-2 px-4 py-3">
        <MethodBadge method="GET" />
        <div className="flex flex-1 items-center gap-2 rounded-lg border border-ink-600 bg-ink-850 px-3 py-2">
          <span className="font-mono text-xs text-mint-300">https://api.example.com</span>
          <span className="font-mono text-xs text-zinc-600">/users</span>
          <div className="ml-auto hidden h-1.5 w-1.5 rounded-full bg-mint-400 sm:block" />
        </div>
        {/* Bouton Send animé */}
        <button
          type="button"
          className={`relative flex items-center gap-1.5 overflow-hidden rounded-lg px-4 py-2 text-xs font-semibold transition-all ${
            phase === "sending"
              ? "bg-mint-500/70 text-ink-950"
              : "bg-mint-500 text-ink-950 hover:bg-mint-400"
          }`}
        >
          {/* Shimmer sur idle */}
          {phase === "idle" && (
            <span
              aria-hidden="true"
              className="animate-shimmer pointer-events-none absolute inset-0"
            />
          )}
          {phase === "sending" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
          {phase === "sending" ? "Envoi…" : "Send"}
        </button>
      </div>

      {/* Barre de progression (visible pendant sending) */}
      <div className="relative h-0.5 w-full bg-ink-700 overflow-hidden">
        <div
          className="absolute left-0 top-0 h-full bg-mint-400 transition-all"
          style={{
            width: phase === "done" ? "100%" : `${progress}%`,
            opacity: phase === "idle" ? 0 : 1,
            transition: phase === "idle" ? "opacity 0.4s" : "width 0.05s linear, opacity 0.2s",
          }}
        />
      </div>

      {/* Contenu : colonnes */}
      <div className="grid grid-cols-1 gap-px bg-ink-700 lg:grid-cols-[1fr_1.15fr]">
        {/* Panneau de gauche : tabs requête */}
        <div className="bg-ink-900 p-4">
          <div className="flex items-center gap-4 border-b border-ink-700 pb-2.5 text-[11px] font-medium">
            {["Params", "Headers", "Body", "Tests"].map((t, i) => (
              <span
                key={t}
                className={
                  i === 2
                    ? "text-white underline decoration-mint-500 decoration-2 underline-offset-8"
                    : "text-zinc-500"
                }
              >
                {t}
              </span>
            ))}
          </div>
          <pre className="mt-4 overflow-x-auto font-mono text-[11.5px] leading-relaxed text-zinc-400 hide-scrollbar">
            {`{`}
            <br />
            <span className="pl-4">
              <span className="text-sky-400">&quot;email&quot;</span>
              <span className="text-zinc-600">: </span>
              <span className="text-mint-300">&quot;ada@reqly.dev&quot;</span>,
            </span>
            <br />
            <span className="pl-4">
              <span className="text-sky-400">&quot;password&quot;</span>
              <span className="text-zinc-600">: </span>
              <span className="text-mint-300">&quot;••••••••••&quot;</span>,
            </span>
            <br />
            <span className="pl-4">
              <span className="text-sky-400">&quot;remember&quot;</span>
              <span className="text-zinc-600">: </span>
              <span className="text-fuchsia-400">true</span>,
            </span>
            <br />
            {`}`}
          </pre>
        </div>

        {/* Panneau de droite : réponse */}
        <div className="bg-ink-900 p-4">
          <div className="flex items-center gap-3">
            {/* Badge status avec pulse animée pendant sending */}
            <span
              className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[11px] font-bold ring-1 transition-all ${
                phase === "sending"
                  ? "bg-amber-500/15 text-amber-300 ring-amber-500/30"
                  : "bg-mint-500/15 text-mint-300 ring-mint-500/30"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  phase === "sending"
                    ? "animate-pulse bg-amber-400"
                    : "animate-pulse-dot bg-mint-400"
                }`}
              />
              {phase === "sending" ? "…" : "200 OK"}
            </span>
            <span className="text-[11px] text-zinc-500">
              {phase === "done" && ms
                ? `${ms} ms · 312 B`
                : phase === "sending"
                  ? "en attente…"
                  : "241 ms · 312 B"}
            </span>
            <span className="ml-auto inline-flex items-center gap-1 rounded-md border border-ink-600 px-2 py-1 text-[11px] text-zinc-300">
              ✨ Résumé IA
            </span>
          </div>

          <pre
            className="mt-4 overflow-x-auto font-mono text-[11.5px] leading-relaxed hide-scrollbar"
            style={{
              opacity: phase === "sending" ? 0.3 : 1,
              transition: "opacity 0.4s",
            }}
          >
            {json.split("\n").map((line, i) => (
              <div
                key={i}
                className="text-zinc-400"
                style={{
                  animation:
                    phase === "done"
                      ? `count-up 0.3s cubic-bezier(0.16,1,0.3,1) ${i * 25}ms both`
                      : "none",
                }}
              >
                {line}
              </div>
            ))}
          </pre>
        </div>
      </div>
    </div>
  );
}

function MethodBadge({ method }: { method: "GET" | "POST" }) {
  const styles =
    method === "GET"
      ? "bg-mint-500/15 text-mint-300 ring-mint-500/30"
      : "bg-amber-500/15 text-amber-300 ring-amber-500/30";
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-1 font-mono text-[11px] font-bold ring-1 ${styles}`}
    >
      {method}
    </span>
  );
}

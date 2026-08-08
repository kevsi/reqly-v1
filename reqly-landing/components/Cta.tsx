"use client";

import { ArrowRight, Download, GitBranch, Github, Heart, ShieldCheck } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { Reveal } from "@/components/Reveal";
import { LINKS } from "@/lib/links";

export function Cta() {
  return (
    <section id="cta" className="relative scroll-mt-20 py-24">
      <div className="mx-auto max-w-6xl px-5">
        <Reveal>
          {/* Bordure dégradée */}
          <CursorSpot
            className="rounded-3xl bg-gradient-to-br from-mint-500/40 via-ink-700/60 to-mint-500/10 p-px"
            childrenWrapClassName="relative overflow-hidden rounded-[calc(1.5rem-1px)] bg-gradient-to-br from-ink-800 via-ink-900 to-ink-950 px-6 py-16 text-center sm:px-12"
          >
            {/* Grille de fond */}
            <div className="grid-pattern absolute inset-0 opacity-60 [mask-image:radial-gradient(ellipse_60%_60%_at_50%_40%,black,transparent)]" />
            {/* Halo haut */}
            <div className="absolute -top-24 left-1/2 h-56 w-[560px] -translate-x-1/2 rounded-full bg-mint-500/15 blur-[100px]" />

            {/* Ligne scan-line CRT — déco subtile */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute left-0 top-0 h-px w-full bg-gradient-to-r from-transparent via-mint-400/50 to-transparent animate-scan-line"
              style={{ animationDuration: "5s" }}
            />

            <div className="relative">
              <h2 className="text-balance text-3xl font-bold tracking-tight text-white sm:text-4xl animate-reveal-blur">
                Prêt à travailler vos API <span className="text-gradient">autrement</span> ?
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-pretty text-zinc-400">
                Lancez Reqly en local en quelques secondes, ou récupérez le code source et
                contribuez.
              </p>

              <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                {/* Bouton principal avec shimmer + glow pulse */}
                <a
                  href="#open-source"
                  className="animate-glow-pulse group relative inline-flex items-center gap-2 overflow-hidden rounded-xl bg-mint-500 px-6 py-3 text-sm font-semibold text-ink-950 shadow-[0_12px_40px_-10px_rgba(16,185,129,0.8)] transition hover:bg-mint-400"
                >
                  <span
                    aria-hidden="true"
                    className="animate-shimmer pointer-events-none absolute inset-0"
                  />
                  <Download className="h-4 w-4" />
                  Lancer Reqly
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </a>

                <a
                  href={LINKS.github}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl border border-ink-600 bg-ink-800/60 px-6 py-3 text-sm font-semibold text-zinc-200 transition hover:border-mint-500/40 hover:text-white"
                >
                  <Github className="h-4 w-4" />
                  Star sur GitHub
                </a>
              </div>

              {/* Preuves de confiance */}
              <div className="mx-auto mt-8 flex max-w-lg flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-zinc-500">
                <span className="inline-flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-mint-400/80" />
                  Open source · MIT
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Download className="h-3.5 w-3.5 text-mint-400/80" />
                  Windows · macOS · Linux
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Heart className="h-3.5 w-3.5 text-mint-400/80" />
                  200+ tests unitaires
                </span>
              </div>
            </div>
          </CursorSpot>
        </Reveal>

        <Reveal delay={120}>
          <div id="open-source" className="mt-6 grid scroll-mt-24 gap-4 sm:grid-cols-2">
            <div className="card-hover rounded-xl border border-ink-700 bg-ink-850/70 p-6">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <GitBranch className="h-4 w-4 text-mint-400" />
                Open source, local d&apos;abord
              </div>
              <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">
                Aucune donnée n&apos;est envoyée sur un serveur tiers pour vos requêtes : tout
                tourne chez vous, avec un proxy durci contre le SSRF et un stockage chiffré.
              </p>
            </div>
            <div className="card-hover rounded-xl border border-ink-700 bg-ink-850/70 p-6">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Heart className="h-4 w-4 text-mint-400" />
                Construit avec soin
              </div>
              <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">
                TypeScript strict, 200+ tests unitaires, tests E2E Playwright et revue de sécurité
                continue — la qualité est une fonctionnalité.
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ── Carte avec halo qui suit le curseur ─────────────── */

function CursorSpot({
  className = "",
  childrenWrapClassName = "",
  children,
}: {
  className?: string;
  childrenWrapClassName?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const onMove = (e: globalThis.MouseEvent) => {
      const rect = el.getBoundingClientRect();
      el.style.setProperty("--spot-x", `${((e.clientX - rect.left) / rect.width) * 100}%`);
      el.style.setProperty("--spot-y", `${((e.clientY - rect.top) / rect.height) * 100}%`);
    };
    el.addEventListener("mousemove", onMove);
    return () => el.removeEventListener("mousemove", onMove);
  }, []);

  return (
    <div ref={ref} className={`spotlight-card group ${className}`}>
      <div className={childrenWrapClassName}>{children}</div>
    </div>
  );
}

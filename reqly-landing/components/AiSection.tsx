"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, CheckCircle2, ListChecks, Sparkles, Wand2 } from "lucide-react";
import { Reveal } from "@/components/Reveal";
import { SectionHeader } from "@/components/SectionHeader";

const bullets = [
  {
    icon: Wand2,
    title: "Génère les requêtes",
    desc: "Décrivez ce que vous voulez, l'assistant construit la requête HTTP ou GraphQL.",
  },
  {
    icon: Sparkles,
    title: "Explique les réponses",
    desc: "Résumez le JSON, identifiez les erreurs et comprenez le statut en une phrase.",
  },
  {
    icon: CheckCircle2,
    title: "Propose des corrections",
    desc: "Détecte les réponses inattendues et suggère des tests pour les verrouiller.",
  },
  {
    icon: ListChecks,
    title: "Planifie et exécute",
    desc: "Mode plan avec vraies actions d'outils, délégation à des sous-agents et approbation avant exécution.",
  },
];

const FULL_TEXT =
  "L'API renvoie 2 utilisateurs. Le champ role indique les permissions : 1 admin, 1 développeur.";

/* ── Hook typewriter ────────────────────────────────── */
function useTypewriter(text: string, speed = 26, active = false) {
  const [count, setCount] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clear() {
    if (timerRef.current) clearTimeout(timerRef.current);
  }

  useEffect(() => {
    if (!active) return;
    let i = 0;
    setCount(0);

    function tick() {
      i += 1;
      setCount(i);
      if (i < text.length) {
        const pause = text[i - 1] === "." ? 200 : speed;
        timerRef.current = setTimeout(tick, pause);
      } else {
        // Redémarre après 5 s
        timerRef.current = setTimeout(() => {
          i = 0;
          setCount(0);
          timerRef.current = setTimeout(tick, 300);
        }, 5000);
      }
    }

    timerRef.current = setTimeout(tick, 500);
    return clear;
  }, [text, speed, active]);

  return text.slice(0, count);
}

export function AiSection() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setStarted(true);
      return;
    }
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setTimeout(() => setStarted(true), 500);
          obs.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const typed = useTypewriter(FULL_TEXT, 26, started);
  const done = typed.length === FULL_TEXT.length;

  return (
    <section id="ai" className="relative scroll-mt-20 overflow-hidden py-24">
      <div className="absolute -left-40 top-1/3 h-[420px] w-[420px] rounded-full bg-mint-500/8 blur-[120px]" />

      <div ref={sectionRef} className="relative mx-auto max-w-6xl px-5">
        <SectionHeader
          eyebrow="Assistant IA"
          title="Un copilote qui comprend vos API"
          sub="Un assistant agentique dans la sidebar : accès au contexte de vos requêtes, outils d'exécution réels, mode plan avec approbation, mentions et suivi d'usage — avec le fournisseur de votre choix."
        />

        <div className="mt-14 grid items-center gap-14 lg:grid-cols-2">
          <Reveal>
            <ul className="space-y-5">
              {bullets.map((b) => (
                <li key={b.title} className="flex gap-4">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-mint-500/12 ring-1 ring-mint-500/25 icon-pop-on-hover">
                    <b.icon className="h-4.5 w-4.5 text-mint-400" strokeWidth={1.8} />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-white">{b.title}</p>
                    <p className="mt-1 text-[13px] leading-relaxed text-zinc-400">{b.desc}</p>
                  </div>
                </li>
              ))}
            </ul>

            <div className="mt-8 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
              <span className="mr-1 text-zinc-600">Fournisseurs :</span>
              {["OpenAI", "Anthropic", "OpenRouter", "Ollama", "Groq"].map((p) => (
                <span
                  key={p}
                  className="rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1 transition-colors hover:border-mint-500/40 hover:text-zinc-300"
                >
                  {p}
                </span>
              ))}
            </div>
          </Reveal>

          {/* Mockup sidebar IA */}
          <Reveal delay={140}>
            <div
              aria-hidden="true"
              className="glow relative rounded-2xl border border-ink-600/80 bg-ink-900/90 p-1.5"
            >
              <div className="overflow-hidden rounded-xl border border-ink-700 bg-ink-950/95">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-ink-700 bg-ink-850 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-mint-500/15 ring-1 ring-mint-500/30">
                      <Bot className="h-3.5 w-3.5 text-mint-400" />
                    </span>
                    <span className="text-sm font-semibold text-white">Assistant IA</span>
                  </div>
                  <span className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                    <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-mint-400" />
                    connecté
                  </span>
                </div>

                <div className="space-y-3 p-4">
                  {/* Message utilisateur */}
                  <div className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-mint-500/15 px-3.5 py-2 text-[12.5px] text-zinc-100 ring-1 ring-mint-500/25">
                      Exécute GET /api/users et résume la réponse
                    </div>
                  </div>

                  {/* Réponse assistant */}
                  <div className="max-w-[92%]">
                    <div className="rounded-2xl rounded-tl-sm border border-ink-700 bg-ink-850 p-3">
                      {/* Indicateur spinner */}
                      <div className="flex items-center gap-2 text-[11.5px] text-zinc-400">
                        <span
                          className={`h-3 w-3 rounded-full border-2 border-mint-500/30 border-t-mint-400 ${
                            !done ? "animate-spin" : "border-mint-400 border-t-mint-400"
                          }`}
                        />
                        {done ? "Terminé" : "Exécution de la requête…"}
                      </div>

                      {/* Tags méthode / route / status */}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <span className="rounded-md bg-mint-500/12 px-2 py-1 font-mono text-[10px] font-bold text-mint-300 ring-1 ring-mint-500/25">
                          GET
                        </span>
                        <span className="rounded-md bg-ink-700 px-2 py-1 font-mono text-[10px] text-zinc-300">
                          /api/users
                        </span>
                        <span className="rounded-md bg-ink-700 px-2 py-1 font-mono text-[10px] text-zinc-400">
                          → 200 OK
                        </span>
                      </div>

                      {/* Texte typewriter */}
                      <p className="mt-2.5 min-h-[3.5em] text-[12.5px] leading-relaxed text-zinc-300">
                        {typed}
                        {/* curseur clignotant */}
                        {!done && (
                          <span
                            aria-hidden="true"
                            className="animate-cursor-blink ml-px inline-block h-3.5 w-[2px] bg-mint-400 align-middle"
                          />
                        )}
                      </p>
                    </div>

                    {/* Suggestion — apparaît quand fini */}
                    <div
                      className={`mt-2 flex w-full items-center gap-2 rounded-xl border border-dashed border-mint-500/40 bg-mint-500/5 px-3.5 py-2.5 text-left text-[12px] text-zinc-300 transition-all duration-500 ${
                        done
                          ? "opacity-100 translate-y-0"
                          : "pointer-events-none opacity-0 translate-y-2"
                      }`}
                    >
                      <Sparkles className="h-3.5 w-3.5 shrink-0 text-mint-400" />
                      Ajouter une assertion : le statut doit être 200
                      <span className="ml-auto text-mint-400">+</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

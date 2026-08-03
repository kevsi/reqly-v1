import { ArrowRight, ChevronDown, Github, TerminalSquare } from "lucide-react";
import { Reveal } from "@/components/Reveal";
import { EditorMockup } from "@/components/EditorMockup";

const stats = [
  { value: "REST + GraphQL", label: "dans un seul outil" },
  {
    value: "100 % local",
    label: "d'abord, chiffré ensuite",
    icon: TerminalSquare,
  },
  { value: "CLI + MCP + API", label: "automatisable à tous les niveaux" },
];

export function Hero() {
  return (
    <section className="relative overflow-hidden" aria-label="Présentation">
      {/* Fond : grille + halos */}
      <div className="grid-pattern absolute inset-0 [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black,transparent)]" />
      <div className="absolute -top-40 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-mint-500/12 blur-[130px]" />
      <div className="absolute -bottom-24 right-[-10%] h-[380px] w-[380px] rounded-full bg-mint-600/10 blur-[120px]" />

      <div className="relative mx-auto max-w-6xl px-5 pb-20 pt-32 sm:pt-40">
        <Reveal className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-mint-500/25 bg-mint-500/10 px-3.5 py-1.5 text-xs font-medium text-mint-300">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-pulse-dot absolute inline-flex h-full w-full rounded-full bg-mint-400" />
            </span>
            Client API moderne, open source &amp; auto-hébergeable
          </span>

          <h1 className="mt-7 text-balance text-4xl font-bold leading-[1.08] tracking-tight text-white sm:text-6xl">
            Testez, documentez et automatisez{" "}
            <span className="text-gradient">vos API</span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-pretty text-base leading-relaxed text-zinc-400 sm:text-lg">
            Reqly réunit REST, GraphQL, collections, environnements, mock
            server et assistant IA dans un playground unique — en local dans
            votre navigateur, sur le desktop, ou piloté depuis le terminal.
          </p>

          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a
              href="#cta"
              className="group inline-flex items-center gap-2 rounded-xl bg-mint-500 px-6 py-3 text-sm font-semibold text-ink-950 shadow-[0_12px_40px_-10px_rgba(16,185,129,0.8)] transition hover:bg-mint-400 hover:shadow-[0_16px_48px_-10px_rgba(16,185,129,0.9)]"
            >
              Lancer Reqly
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </a>
            <a
              href="#open-source"
              className="inline-flex items-center gap-2 rounded-xl border border-ink-600 bg-ink-800/60 px-6 py-3 text-sm font-semibold text-zinc-200 transition hover:border-mint-500/40 hover:text-white"
            >
              <Github className="h-4 w-4" />
              Voir sur GitHub
            </a>
          </div>
        </Reveal>

        {/* Mockup de l'éditeur */}
        <Reveal delay={150} className="relative mt-16">
          <div className="glow relative rounded-2xl border border-ink-600/80 bg-ink-900/90 p-1.5 backdrop-blur">
            <EditorMockup />
          </div>
          <div className="absolute -inset-x-8 -bottom-10 -z-10 h-40 rounded-full bg-mint-500/10 blur-[80px]" />
        </Reveal>

        {/* Stats */}
        <Reveal delay={280}>
          <dl className="mx-auto mt-16 grid max-w-3xl grid-cols-1 gap-8 sm:grid-cols-3">
            {stats.map((s) => (
              <div
                key={s.value}
                className="text-center sm:border-l sm:border-ink-700/60 sm:first:border-l-0"
              >
                <dt className="flex items-center justify-center gap-2 text-lg font-semibold text-white">
                  {s.icon && <s.icon className="h-4 w-4 text-mint-400" />}
                  {s.value}
                </dt>
                <dd className="mt-1 text-sm text-zinc-500">{s.label}</dd>
              </div>
            ))}
          </dl>
        </Reveal>

        {/* Indicateur de scroll */}
        <div className="mt-16 flex justify-center">
          <a
            href="#integrations"
            aria-label="Faire défiler vers la suite"
            className="animate-bounce-soft flex h-9 w-9 items-center justify-center rounded-full border border-ink-700 text-zinc-500 transition hover:border-mint-500/40 hover:text-mint-300"
          >
            <ChevronDown className="h-4 w-4" />
          </a>
        </div>
      </div>
    </section>
  );
}

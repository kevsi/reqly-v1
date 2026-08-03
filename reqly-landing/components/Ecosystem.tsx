import { AppWindow, Cloud, Cpu, Terminal } from "lucide-react";
import { Reveal } from "@/components/Reveal";
import { SectionHeader } from "@/components/SectionHeader";
import { SpotlightCard } from "@/components/SpotlightCard";

const cards = [
  {
    icon: AppWindow,
    title: "Desktop",
    tech: "Tauri · Rust",
    desc: "L'application desktop légère avec chiffrement des secrets via le keychain natif et gestion d'OpenAPI.",
  },
  {
    icon: Terminal,
    title: "CLI",
    tech: "recli",
    desc: "Exécutez des collections dans votre CI et générez des rapports JUnit / HTML / JSON, sans interface.",
  },
  {
    icon: Cpu,
    title: "MCP Server",
    tech: "Model Context Protocol",
    desc: "Exposez vos collections aux assistants IA (Claude, etc.) en tant que serveur MCP standard.",
  },
  {
    icon: Cloud,
    title: "Sync Server",
    tech: "Hono · SQLite",
    desc: "Synchronisation auto-hébergeable de vos workspaces entre machines — vous gardez le contrôle des données.",
  },
];

export function Ecosystem() {
  return (
    <section id="ecosystem" className="relative scroll-mt-20 py-24">
      <div className="mx-auto max-w-6xl px-5">
        <SectionHeader
          eyebrow="Écosystème"
          title="Le navigateur n'est que le début"
          sub="Un même moteur de requêtes, décliné partout où vous travaillez."
        />

        <div className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map((c, i) => (
            <Reveal key={c.title} delay={i * 80}>
              <SpotlightCard className="card-hover group flex h-full flex-col rounded-xl border border-ink-700 bg-ink-850/70 p-5">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-mint-500/12 ring-1 ring-mint-500/25 transition group-hover:bg-mint-500/20 group-hover:ring-mint-500/40">
                  <c.icon className="h-5 w-5 text-mint-400" strokeWidth={1.8} />
                </div>
                <h3 className="mt-4 text-sm font-semibold text-white">
                  {c.title}
                </h3>
                <span className="mt-1 font-mono text-[10.5px] uppercase tracking-wide text-mint-400/80">
                  {c.tech}
                </span>
                <p className="mt-3 text-[13px] leading-relaxed text-zinc-400">
                  {c.desc}
                </p>
              </SpotlightCard>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

import { Github, MessageCircle, Rss, Twitter, Zap } from "lucide-react";

const columns = [
  {
    title: "Produit",
    links: ["Fonctionnalités", "Assistant IA", "Mock server", "CLI", "MCP Server"],
  },
  {
    title: "Intégrations",
    links: ["Postman", "OpenAPI", "Bruno", "GitHub", "GitLab"],
  },
  {
    title: "Ressources",
    links: ["Documentation", "Guide de démarrage", "Changelog", "Statut", "Support"],
  },
];

const socials = [
  { icon: Github, label: "GitHub" },
  { icon: Twitter, label: "X / Twitter" },
  { icon: MessageCircle, label: "Discord" },
  { icon: Rss, label: "Flux RSS" },
];

export function Footer() {
  return (
    <footer className="border-t border-ink-700/60 bg-ink-900/30">
      <div className="mx-auto max-w-6xl px-5 py-14">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-mint-500/15 ring-1 ring-mint-500/30">
                <Zap className="h-4.5 w-4.5 text-mint-400" strokeWidth={2.5} />
              </span>
              <span className="text-lg font-semibold tracking-tight text-white">
                Reqly
              </span>
            </div>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-zinc-500">
              Le playground API moderne, open source et auto-hébergeable.
              REST, GraphQL, IA et automatisation — un seul outil.
            </p>
            <div className="mt-5 flex items-center gap-2">
              {socials.map((s) => (
                <a
                  key={s.label}
                  href="#"
                  aria-label={s.label}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-ink-700 bg-ink-850 text-zinc-500 transition hover:border-mint-500/40 hover:text-mint-300"
                >
                  <s.icon className="h-4 w-4" />
                </a>
              ))}
            </div>
          </div>

          {columns.map((col) => (
            <div key={col.title}>
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                {col.title}
              </p>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l}>
                    <a
                      href="#"
                      className="text-sm text-zinc-400 transition hover:text-mint-300"
                    >
                      {l}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-ink-700/60 pt-6 text-xs text-zinc-600 sm:flex-row">
          <p>© {new Date().getFullYear()} Reqly. Tous droits réservés.</p>
          <p className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-mint-400" />
            Tous les services sont opérationnels
          </p>
        </div>
      </div>
    </footer>
  );
}

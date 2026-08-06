import Link from "next/link";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { baseOptions } from "@/lib/layout.shared";
import {
  Braces,
  CheckCircle2,
  PlayCircle,
  Server,
  Sparkles,
  Terminal,
  Waypoints,
} from "lucide-react";
import { i18n } from "@/lib/i18n";

const copy = {
  en: {
    badge: "Reqly MCP Server",
    title: "Let AI agents run your API test suite",
    subtitle:
      "A Model Context Protocol server that exposes Reqly collections to Claude, Cursor and any MCP client — execute requests, evaluate assertions, and manage collections through plain conversation.",
    features: [
      {
        icon: Braces,
        iconClass: "",
        title: "44 tools",
        description:
          "Run and assert API collections, manage request suites — everything an AI agent needs.",
      },
      {
        icon: Waypoints,
        iconClass: "",
        title: "Two transports",
        description: "stdio for local agents, streamable HTTP for remote clients.",
      },
      {
        icon: Sparkles,
        iconClass: "",
        title: "OpenAPI native",
        description: "Import specs, generate edge-case tests, sync and diff live servers.",
      },
    ],
    readDocs: "Read the docs",
    quickStart: "Quick start",
    terminal: "recli · live",
    connected: "connected",
    waiting: "waiting for next command",
  },
  fr: {
    badge: "Reqly MCP Server",
    title: "Laissez les agents IA exécuter votre suite de tests API",
    subtitle:
      "Un serveur Model Context Protocol qui expose les collections Reqly à Claude, Cursor et à tout client MCP — exécutez des requêtes, évaluez les assertions et gérez vos collections en langage naturel.",
    features: [
      {
        icon: Braces,
        iconClass: "",
        title: "44 outils",
        description:
          "Exécutez et testez des collections API, gérez des suites de requêtes — tout ce dont un agent IA a besoin.",
      },
      {
        icon: Waypoints,
        iconClass: "",
        title: "Deux transports",
        description: "stdio pour les agents locaux, HTTP streamable pour les clients distants.",
      },
      {
        icon: Sparkles,
        iconClass: "",
        title: "Natif OpenAPI",
        description:
          "Importez des specs, générez des tests de cas limites, synchronisez et différenciez les serveurs.",
      },
    ],
    readDocs: "Lire la documentation",
    quickStart: "Démarrage rapide",
    terminal: "recli · en direct",
    connected: "connecté",
    waiting: "en attente de la prochaine commande",
  },
} as const;

const steps = [
  ["list_collections", "found 1 collection", "1 collection trouvée"],
  ["run_request", '"List posts" → 200 OK, 2/2 assertions', '"List posts" → 200 OK, 2/2 assertions'],
  ["export_collection_to_junit", "written · ready for CI", "écrit · prêt pour la CI"],
] as const;

type Lang = (typeof i18n)["languages"][number];

export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const t = copy[lang as Lang] ?? copy.en;

  return (
    <HomeLayout {...baseOptions()}>
      <div className="flex flex-col justify-center text-center flex-1 gap-12 py-12">
        <div className="flex flex-col items-center">
          <p className="text-sm font-medium text-fd-muted-foreground mb-3 inline-flex items-center gap-1.5">
            <Server
              className="size-4 animate-[fd-pulse-soft_2.4s_ease-in-out_infinite]"
              aria-hidden
            />
            {t.badge}
          </p>
          <h1 className="text-4xl font-bold mb-4">{t.title}</h1>
          <p className="text-fd-muted-foreground max-w-xl mx-auto">{t.subtitle}</p>
        </div>

        <div className="grid sm:grid-cols-3 gap-4 max-w-3xl mx-auto w-full">
          {t.features.map((f, i) => (
            <div
              key={f.title}
              className="group border rounded-lg p-4 text-left transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-fd-primary/10 hover:border-fd-border"
            >
              <div
                className={`inline-flex items-center justify-center p-2 rounded-md bg-fd-primary/10 text-fd-primary mb-3 ${[Braces, Waypoints, Sparkles][i] === Waypoints ? "animate-[fd-float_5s_ease-in-out_infinite]" : "animate-[fd-pulse-soft_3.2s_ease-in-out_infinite]"}`}
                aria-hidden
              >
                <f.icon className="size-5 transition-transform duration-300 group-hover:scale-125" />
              </div>
              <h2 className="font-semibold mb-1">{f.title}</h2>
              <p className="text-sm text-fd-muted-foreground">{f.description}</p>
            </div>
          ))}
        </div>

        <div className="flex justify-center gap-4">
          <Link
            href={`/${lang}/docs`}
            className="rounded-lg bg-fd-primary text-fd-primary-foreground px-4 py-2 text-sm font-medium inline-flex items-center gap-2 transition-transform hover:scale-[1.03]"
          >
            <Terminal className="size-4" aria-hidden />
            {t.readDocs}
          </Link>
          <Link
            href={`/${lang}/docs/getting-started`}
            className="rounded-lg border px-4 py-2 text-sm font-medium inline-flex items-center gap-2 transition-transform hover:scale-[1.03]"
          >
            {t.quickStart}
          </Link>
        </div>

        <div className="max-w-2xl mx-auto w-full text-left rounded-xl border bg-fd-card text-sm overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b bg-fd-secondary/50">
            <Server className="size-4 text-fd-muted-foreground" aria-hidden />
            <span className="font-mono text-fd-muted-foreground">{t.terminal}</span>
            <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-fd-muted-foreground">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full rounded-full bg-fd-primary opacity-75 animate-ping" />
                <span className="relative inline-flex size-2 rounded-full bg-fd-primary" />
              </span>
              {t.connected}
            </span>
          </div>
          <ul className="p-4 space-y-2 text-left font-mono text-xs">
            {steps.map(([method, noteEn, noteFr], i) => (
              <li key={i} className="inline-flex items-start gap-2.5">
                <CheckCircle2 className="size-4 mt-px shrink-0 text-fd-primary" aria-hidden />
                <span className="truncate">
                  <span className="text-fd-muted-foreground">{method}</span>
                  <span className="text-fd-muted-foreground"> → </span>
                  <span className="text-fd-foreground">{lang === "fr" ? noteFr : noteEn}</span>
                </span>
              </li>
            ))}
            <li className="inline-flex items-center gap-2.5">
              <PlayCircle className="size-4 mt-px shrink-0 text-fd-primary" aria-hidden />
              <span className="inline-flex items-center text-fd-muted-foreground">
                {t.waiting}
                <span className="ml-1 inline-block h-3.5 w-[1.5px] bg-fd-foreground animate-pulse" />
              </span>
            </li>
          </ul>
        </div>
        <div className="-mt-6 text-xs inline-flex items-center gap-1.5 justify-center text-fd-muted-foreground">
          <Server className="size-3.5" aria-hidden />
          {lang === "fr"
            ? "écouter — exécuter — asserter — exporter, une boucle."
            : "listen — run — assert — export, one loop."}
        </div>
      </div>
    </HomeLayout>
  );
}

export function generateStaticParams() {
  return i18n.languages.map((lang) => ({ lang }));
}

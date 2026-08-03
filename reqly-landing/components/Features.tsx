import {
  Boxes,
  Database,
  FileCode2,
  FlaskConical,
  FolderTree,
  Globe,
  History,
  Server,
  ShieldCheck,
  Variable,
} from "lucide-react";
import { Reveal } from "@/components/Reveal";
import { SectionHeader } from "@/components/SectionHeader";
import { SpotlightCard } from "@/components/SpotlightCard";

const features = [
  {
    icon: Globe,
    title: "REST & GraphQL",
    desc: "Requêtes HTTP complètes et playground GraphQL avec variables, onglets multiples et téléchargement de fichiers.",
  },
  {
    icon: Boxes,
    title: "Collections & environnements",
    desc: "Organisez vos requêtes en collections hiérarchiques avec drag & drop, et partagez des variables par environnement.",
  },
  {
    icon: Variable,
    title: "Variables & chaining",
    desc: "Extrayez des valeurs des réponses pour les réutiliser dans les requêtes suivantes, avec prévisualisation en direct.",
  },
  {
    icon: FlaskConical,
    title: "Tests & assertions",
    desc: "Scripts de test, assertions JSON Schema et exécution de collections entières avec rapport JUnit — parfait pour le CI.",
  },
  {
    icon: Server,
    title: "Mock server local",
    desc: "Transformez vos routes en serveur mock local en un clic, servies en temps réel sur votre machine.",
  },
  {
    icon: History,
    title: "Historique & recherche",
    desc: "Retrouvez n'importe quelle requête passée, avec recherche instantanée et variables intégrées.",
  },
  {
    icon: FileCode2,
    title: "Code snippets",
    desc: "Générez le code de votre requête dans une dizaine de langages (cURL, JS, Python, Go, Rust…) en un clic.",
  },
  {
    icon: ShieldCheck,
    title: "Sécurité d'abord",
    desc: "Proxy durci (anti-SSRF), stockage chiffré AES-256-GCM et zero-exfiltration : vos données restent chez vous.",
  },
];

export function Features() {
  return (
    <section id="features" className="relative scroll-mt-20 py-24">
      <div className="absolute left-1/2 top-0 h-px w-2/3 -translate-x-1/2 bg-gradient-to-r from-transparent via-mint-500/40 to-transparent" />
      <div className="mx-auto max-w-6xl px-5">
        <SectionHeader
          eyebrow="Fonctionnalités"
          title="Tout ce qu'il faut pour travailler vos API"
          sub="Un seul espace de travail, du premier appel à la suite de tests automatisée."
        />

        <div className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f, i) => (
            <Reveal key={f.title} delay={(i % 4) * 70}>
              <SpotlightCard className="card-hover group h-full rounded-xl border border-ink-700 bg-ink-850/70 p-5">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-mint-500/12 ring-1 ring-mint-500/25 transition group-hover:bg-mint-500/20 group-hover:ring-mint-500/40">
                  <f.icon className="h-5 w-5 text-mint-400" strokeWidth={1.8} />
                </div>
                <h3 className="mt-4 text-sm font-semibold text-white">
                  {f.title}
                </h3>
                <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">
                  {f.desc}
                </p>
              </SpotlightCard>
            </Reveal>
          ))}
        </div>

        {/* Mini bandeau collection */}
        <Reveal delay={120}>
          <div className="mt-6 flex flex-col items-center justify-between gap-4 rounded-xl border border-mint-500/20 bg-gradient-to-r from-mint-500/10 via-ink-850 to-ink-850 px-6 py-5 sm:flex-row">
            <div className="flex items-center gap-4">
              <FolderTree className="h-8 w-8 text-mint-400" strokeWidth={1.6} />
              <div>
                <p className="text-sm font-semibold text-white">
                  Importez votre collection existante
                </p>
                <p className="text-[13px] text-zinc-400">
                  Postman, OpenAPI, Bruno — ou collez simplement une commande
                  cURL.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 font-mono text-xs text-zinc-400">
              <Database className="h-4 w-4 text-mint-400" />
              curl -X POST https://api.example.com/users
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

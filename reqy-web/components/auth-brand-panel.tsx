"use client";

import { GitBranch, ShieldCheck, Zap } from "lucide-react";

const FEATURES = [
  {
    icon: Zap,
    title: "Testez vos APIs en un éclair",
    description: "Requêtes REST, GraphQL et SSE dans une interface unifiée.",
  },
  {
    icon: GitBranch,
    title: "Collections versionnées",
    description: "Synchronisez vos projets via Git, seul ou en équipe.",
  },
  {
    icon: ShieldCheck,
    title: "Sécurité by design",
    description: "Sessions chiffrées, capture de trafic locale, zéro télémétrie.",
  },
];

/**
 * Brand panel shown on the left half of auth pages (login, signup).
 * Hidden below `lg`. Pairs with a right-hand form section using
 * `grid min-h-screen lg:grid-cols-2` on the parent <main>.
 */
export function AuthBrandPanel() {
  return (
    <section className="relative hidden overflow-hidden bg-primary lg:flex lg:flex-col lg:justify-between lg:p-12">
      {/* Decorative glows */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -right-40 size-[480px] rounded-full opacity-30 blur-3xl"
        style={{ background: "radial-gradient(circle, oklch(1 0 0 / .35), transparent 65%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-48 -left-32 size-[520px] rounded-full opacity-20 blur-3xl"
        style={{ background: "radial-gradient(circle, oklch(0.2 0.05 160 / .8), transparent 70%)" }}
      />

      {/* Logo */}
      <div className="relative flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-foreground text-lg font-black text-primary shadow-lg">
          R
        </div>
        <span className="text-xl font-bold tracking-tight text-primary-foreground">Reqly</span>
      </div>

      {/* Tagline + features */}
      <div className="relative space-y-8">
        <div className="max-w-md space-y-4">
          <h2 className="text-4xl font-bold leading-tight tracking-tight text-primary-foreground">
            Votre atelier API, du premier appel au déploiement.
          </h2>
          <p className="text-base leading-relaxed text-primary-foreground/80">
            Concevez, testez et documentez vos APIs — avec la puissance d&apos;un desktop natif et
            la simplicité du web.
          </p>
        </div>

        <ul className="space-y-5">
          {FEATURES.map(({ icon: Icon, title, description }) => (
            <li key={title} className="flex items-start gap-4">
              <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-foreground/15 ring-1 ring-primary-foreground/20 backdrop-blur-sm">
                <Icon className="size-5 text-primary-foreground" />
              </span>
              <div>
                <p className="font-semibold text-primary-foreground">{title}</p>
                <p className="text-sm text-primary-foreground/70">{description}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Footer strip */}
      <div className="relative text-xs text-primary-foreground/60">
        Disponible sur Windows · macOS · Linux · Web
      </div>
    </section>
  );
}

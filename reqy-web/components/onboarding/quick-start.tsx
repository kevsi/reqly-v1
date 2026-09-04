"use client";

/**
 * Quick-start du premier lancement (audit UX 2026-09-04 : l'utilisateur
 * nouveau arrivait sur un éditeur vide sans aucun repère).
 *
 * Panneau discret en haut de la page principale, 3 étapes dont la complétion
 * est auto-détectée depuis l'état du store. Disparaît définitivement :
 * « Passer » ou la 3e étape cochée → completeOnboarding().
 */

import { Check, Circle, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRequestStore } from "@/hooks/use-request-store";
import { cn } from "@/lib/utils";

const K = {
  title: "onboarding.title",
  subtitle: "onboarding.subtitle",
  step1: "onboarding.step1",
  step2: "onboarding.step2",
  step3: "onboarding.step3",
  dismiss: "onboarding.dismiss",
} as const;

export function QuickStart() {
  const { t } = useTranslation();
  const history = useRequestStore((s) => s.history);
  const collections = useRequestStore((s) => s.collections);
  const completeOnboarding = useRequestStore((s) => s.completeOnboarding);

  // Auto-détection de complétion depuis l'état réel du store.
  const steps = [
    { label: t(K.step1), done: history.length > 0 },
    {
      label: t(K.step2),
      done: collections.some((c) => c.requests.some((r) => (r.runnerAssertions?.length ?? 0) > 0)),
    },
    {
      label: t(K.step3),
      done: collections.filter((c) => c.name !== "Drafts").length > 0,
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  if (doneCount === steps.length) {
    // Tout est accompli : clore définitivement sans demander.
    completeOnboarding();
    return null;
  }

  return (
    <div
      className="mb-4 rounded-lg border border-border bg-card p-4"
      data-testid="onboarding-quick-start"
      role="region"
      aria-label={t(K.title)}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{t(K.title)}</p>
          <p className="text-muted-foreground text-xs">{t(K.subtitle, { done: doneCount, total: steps.length })}</p>
        </div>
        <button
          type="button"
          onClick={completeOnboarding}
          aria-label={t(K.dismiss)}
          className="text-muted-foreground hover:text-foreground"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
      <ul className="mt-3 space-y-2">
        {steps.map((step) => (
          <li key={step.label} className="flex items-center gap-2 text-sm">
            {step.done ? (
              <Check aria-hidden="true" className="size-4 text-emerald-500" />
            ) : (
              <Circle aria-hidden="true" className="text-muted-foreground/40 size-4" />
            )}
            <span className={cn(step.done && "text-muted-foreground line-through")}>{step.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

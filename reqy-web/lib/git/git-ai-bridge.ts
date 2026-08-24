"use client";

/**
 * Pont entre le hook use-git (instance GitService par surface React) et les
 * outils IA git. Le hook enregistre un getter vers son service courant ; les
 * outils refusent proprement si aucun dépôt n'a été ouvert dans la session.
 */
import type { GitService } from "./git-service";

let getService: (() => GitService | null) | null = null;

export function registerGitService(provider: (() => GitService | null) | null): void {
  getService = provider;
}

/** Service actif, ou une erreur lisible pour le modèle si indisponible. */
export function requireGitService(): { service: GitService } | { error: string } {
  const svc = getService?.() ?? null;
  if (!svc) {
    return {
      error:
        "Aucun dépôt Git ouvert. Demande à l'utilisateur d'ouvrir le panneau Git et de sélectionner son dépôt.",
    };
  }
  return { service: svc };
}

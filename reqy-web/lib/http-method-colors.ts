// ── Source unique des couleurs par méthode HTTP ──────────────────────────
// Toutes les classes Tailwind sont écrites en littéral pour que le JIT les détecte.
// NE PAS concaténer dynamiquement "bg-" + hue + "-500" — le JIT ne les verrait pas.

import type { HttpMethod } from "@/lib/types";

// ── Teinte de base pour chaque méthode ───────────────────────────────────

export const METHOD_HUE: Record<HttpMethod, string> = {
  GET: "emerald",
  POST: "blue",
  PUT: "amber",
  PATCH: "purple",
  DELETE: "red",
  HEAD: "slate",
  OPTIONS: "slate",
  GRAPHQL: "pink",
};

// ── Variantes de classes Tailwind ────────────────────────────────────────

/** Badge plein — ex: onglet de requête, pilule dans les listes */
export const methodBadge: Record<HttpMethod, string> = {
  GET: "bg-emerald-700 text-white border-emerald-700",
  POST: "bg-blue-600 text-white border-blue-600",
  PUT: "bg-amber-700 text-white border-amber-700",
  PATCH: "bg-purple-600 text-white border-purple-600",
  DELETE: "bg-red-700 text-white border-red-700",
  HEAD: "bg-slate-600 text-white border-slate-600",
  OPTIONS: "bg-slate-600 text-white border-slate-600",
  GRAPHQL: "bg-pink-600 text-white border-pink-600",
};

/** Subtile — fond transparent, utilisé dans les listes et l'historique */
export const methodSubtle: Record<HttpMethod, string> = {
  GET: "bg-emerald-500/20 text-emerald-600 border-emerald-500/30",
  POST: "bg-blue-500/20 text-blue-600 border-blue-500/30",
  PUT: "bg-amber-500/20 text-amber-600 border-amber-500/30",
  PATCH: "bg-purple-500/20 text-purple-600 border-purple-500/30",
  DELETE: "bg-red-500/20 text-red-600 border-red-500/30",
  HEAD: "bg-slate-500/20 text-slate-600 border-slate-500/30",
  OPTIONS: "bg-slate-500/20 text-slate-600 border-slate-500/30",
  GRAPHQL: "bg-pink-500/20 text-pink-600 border-pink-500/30",
};

/** Point de couleur (dot) — utilisé pour les indicateurs de méthode */
export const methodDot: Record<HttpMethod, string> = {
  GET: "bg-emerald-500",
  POST: "bg-blue-500",
  PUT: "bg-amber-500",
  PATCH: "bg-purple-500",
  DELETE: "bg-red-500",
  HEAD: "bg-slate-500",
  OPTIONS: "bg-slate-500",
  GRAPHQL: "bg-pink-500",
};

/** Texte seul — pour les labels */
export const methodText: Record<HttpMethod, string> = {
  GET: "text-emerald-500",
  POST: "text-blue-500",
  PUT: "text-amber-500",
  PATCH: "text-purple-500",
  DELETE: "text-red-500",
  HEAD: "text-slate-500",
  OPTIONS: "text-slate-500",
  GRAPHQL: "text-pink-500",
};

/** Accent de panneau — bordure basse + fond très léger */
export const methodPanelAccent: Record<HttpMethod, string> = {
  GET: "border-b-emerald-500/15 bg-emerald-500/[0.02]",
  POST: "border-b-blue-500/15 bg-blue-500/[0.02]",
  PUT: "border-b-amber-500/15 bg-amber-500/[0.02]",
  PATCH: "border-b-purple-500/15 bg-purple-500/[0.02]",
  DELETE: "border-b-red-500/15 bg-red-500/[0.02]",
  HEAD: "border-b-slate-500/15 bg-slate-500/[0.02]",
  OPTIONS: "border-b-slate-500/15 bg-slate-500/[0.02]",
  GRAPHQL: "border-b-pink-500/15 bg-pink-500/[0.02]",
};

/** Handle de redimensionnement — couleur de la barre entre les panneaux */
export const methodHandle: Record<HttpMethod, string> = {
  GET: "bg-emerald-500/30",
  POST: "bg-blue-500/30",
  PUT: "bg-amber-500/30",
  PATCH: "bg-purple-500/30",
  DELETE: "bg-red-500/30",
  HEAD: "bg-slate-500/30",
  OPTIONS: "bg-slate-500/30",
  GRAPHQL: "bg-pink-500/30",
};

/** Fond plein pour le sélecteur de méthode et le bouton d'envoi */
export const methodBg: Record<HttpMethod, string> = {
  GET: "bg-emerald-500",
  POST: "bg-blue-500",
  PUT: "bg-amber-500",
  PATCH: "bg-purple-500",
  DELETE: "bg-red-500",
  HEAD: "bg-slate-500",
  OPTIONS: "bg-slate-500",
  GRAPHQL: "bg-pink-500",
};

/** Classes avec sélection (dropdown) — fond + texte avec plus d'opacité */
export const methodSelect: Record<HttpMethod, string> = {
  GET: "bg-emerald-500/25 text-emerald-600 border-emerald-500/30",
  POST: "bg-blue-500/25 text-blue-600 border-blue-500/30",
  PUT: "bg-amber-500/25 text-amber-600 border-amber-500/30",
  PATCH: "bg-purple-500/25 text-purple-600 border-purple-500/30",
  DELETE: "bg-red-500/25 text-red-600 border-red-500/30",
  HEAD: "bg-slate-500/25 text-slate-600 border-slate-500/30",
  OPTIONS: "bg-slate-500/25 text-slate-600 border-slate-500/30",
  GRAPHQL: "bg-pink-500/25 text-pink-600 border-pink-500/30",
};

// ── Helpers pour la rétrocompatibilité ───────────────────────────────────

/** @deprecated Utilise `methodBadge` ou `methodSubtle` à la place */
export const methodColors: Record<HttpMethod, string> = methodBadge;

export function getMethodBadgeClass(method: HttpMethod): string {
  return methodBadge[method] ?? "bg-red-500 text-white border-red-500";
}

export function getMethodDotClass(method: HttpMethod): string {
  return methodDot[method] ?? "bg-red-500";
}

export function getMethodPanelClass(method: HttpMethod): string {
  return methodPanelAccent[method] ?? "border-b-red-500/15 bg-red-500/[0.02]";
}

export function getMethodHandleClass(method: HttpMethod): string {
  return methodHandle[method] ?? "bg-red-500/30";
}

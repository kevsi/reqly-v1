// ── Source unique des couleurs par statut HTTP ───────────────────────────
// Centralise la logique de mapping statut → classe Tailwind.
// Toutes les classes sont en littéral pour que le JIT les détecte.

type Hue = "emerald" | "blue" | "amber" | "red";

function band(status: number | null | undefined): Hue {
  if (status == null) return "emerald";
  if (status >= 200 && status < 300) return "emerald";
  if (status >= 300 && status < 400) return "blue";
  if (status >= 400 && status < 500) return "amber";
  return "red";
}

/** Badge complet : fond + texte + bordure */
export function getStatusBadgeClass(status?: number | null): string {
  if (status == null) return "bg-muted text-muted-foreground";
  const h = band(status);
  if (h === "emerald") return "bg-emerald-500/20 text-emerald-600 border-emerald-500/30";
  if (h === "blue") return "bg-blue-500/20 text-blue-600 border-blue-500/30";
  if (h === "amber") return "bg-amber-500/20 text-amber-600 border-amber-500/30";
  return "bg-red-500/20 text-red-600 border-red-500/30";
}

/** Texte uniquement */
export function getStatusTextClass(status?: number | null): string {
  if (status == null) return "text-muted-foreground";
  const h = band(status);
  if (h === "emerald") return "text-emerald-500";
  if (h === "blue") return "text-blue-500";
  if (h === "amber") return "text-amber-500";
  if (h === "red") return "text-red-500";
  return "text-muted-foreground";
}

/** Bordure d'accent gauche */
export function getStatusBorderAccentClass(status?: number | null): string {
  if (status == null) return "";
  const h = band(status);
  if (h === "emerald") return "border-l-2 border-l-emerald-500";
  if (h === "blue") return "border-l-2 border-l-blue-500";
  if (h === "amber") return "border-l-2 border-l-amber-500";
  if (h === "red") return "border-l-2 border-l-red-500";
  return "";
}

/** Couleur de jauge de temps de réponse */
export function getStatusGaugeClass(timeMs?: number | null): string {
  if (timeMs == null) return "bg-muted-foreground";
  if (timeMs < 300) return "bg-emerald-500";
  if (timeMs < 1000) return "bg-amber-500";
  return "bg-red-500";
}

/** Texte filigrane géant (très faible opacité) */
export function getStatusWatermarkClass(status?: number | null): string {
  if (status == null) return "text-muted-foreground/5";
  const h = band(status);
  if (h === "emerald") return "text-emerald-500/10";
  if (h === "blue") return "text-blue-500/10";
  if (h === "amber") return "text-amber-500/10";
  if (h === "red") return "text-red-500/10";
  return "text-muted-foreground/5";
}

/** Libellé textuel du statut */
export function getStatusLabel(status?: number | null): string {
  if (status == null) return "";
  const h = band(status);
  if (h === "emerald") return "Succès";
  if (h === "blue") return "Redirection";
  if (h === "amber") return "Erreur client";
  return "Erreur serveur";
}

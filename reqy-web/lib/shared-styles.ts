// ── Classes Tailwind partagées — source unique des patterns dupliqués ────

// ── Boutons icônes ───────────────────────────────────────────────────────

/** Bouton icône standard (ghost, taille sm) */
export const ICON_BUTTON =
  "flex size-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors";

/** Bouton icône dans le header du AI sidebar */
export const HEADER_ICON_BUTTON = ICON_BUTTON;

/** Bouton icône dans un message */
export const MESSAGE_ACTION_BUTTON =
  "flex size-7 items-center justify-center rounded-md opacity-0 group-hover:opacity-100 transition-all duration-200 text-muted-foreground hover:text-foreground hover:bg-accent";

// ── Tabs ─────────────────────────────────────────────────────────────────

/** Trigger d'onglet de réponse */
export const RESPONSE_TAB_TRIGGER =
  "inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium transition-colors rounded-md data-[state=active]:bg-muted/60 data-[state=active]:text-foreground text-muted-foreground hover:text-foreground";

// ── Transitions ──────────────────────────────────────────────────────────

/** Transition standard pour les éléments interactifs */
export const TRANSITION_STANDARD = "transition-all duration-200";

/** Transition de couleur seulement */
export const TRANSITION_COLOR = "transition-colors duration-200";

// ── Méthodes HTTP — format badge ─────────────────────────────────────────

export { methodBadge, methodSubtle, methodDot, methodText, methodBg, methodSelect, methodPanelAccent } from "@/lib/http-method-colors";

import React from "react"
import { Lock, Users, Package, FolderKanban, Layers, Sparkles } from "lucide-react"

// ── Premium palette : desaturée, outil pro (Linear / Raycast)
// Chaque couleur = fond muted + ring subtil + dot premium
export const collectionColors: Record<string, string> = {
  emerald: "bg-emerald-600",
  blue: "bg-blue-600",
  amber: "bg-amber-600",
  purple: "bg-violet-600",
  red: "bg-red-600",
  pink: "bg-pink-600",
  slate: "bg-slate-600",
  indigo: "bg-indigo-600",
  violet: "bg-violet-600",
  orange: "bg-orange-600",
}

// Accent de bord gauche (premium) — même teinte en 12% d'opacité
export const collectionAccent: Record<string, string> = {
  emerald: "bg-emerald-600",
  blue: "bg-blue-600",
  amber: "bg-amber-600",
  purple: "bg-violet-600",
  red: "bg-red-600",
  pink: "bg-pink-600",
  slate: "bg-slate-600",
  indigo: "bg-indigo-600",
  violet: "bg-violet-600",
  orange: "bg-orange-600",
}

// Fond très léger pour highlight / hover — cohérent avec hsl primary/5
export const collectionSurface: Record<string, string> = {
  emerald: "bg-emerald-600/[0.04]",
  blue: "bg-blue-600/[0.04]",
  amber: "bg-amber-600/[0.04]",
  purple: "bg-violet-600/[0.04]",
  red: "bg-red-600/[0.04]",
  pink: "bg-pink-600/[0.04]",
  slate: "bg-slate-600/[0.04]",
  indigo: "bg-indigo-600/[0.04]",
  violet: "bg-violet-600/[0.04]",
  orange: "bg-orange-600/[0.04]",
}

const VALID_COLORS = new Set(Object.keys(collectionColors))
const DEFAULT_COLOR = "indigo"

export function safeColor(color: string): string {
  return VALID_COLORS.has(color) ? color : DEFAULT_COLOR
}

export const collectionIcons: Record<string, React.ReactNode> = {
  lock: <Lock className="size-3 text-white" />,
  users: <Users className="size-3 text-white" />,
  package: <Package className="size-3 text-white" />,
  folder: <FolderKanban className="size-3 text-white" />,
  layers: <Layers className="size-3 text-white" />,
  sparkles: <Sparkles className="size-3 text-white" />,
}

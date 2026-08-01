import React from "react"
import { Lock, Users, Package } from "lucide-react"

export const collectionColors: Record<string, string> = {
  emerald: "bg-emerald-500",
  blue: "bg-blue-500",
  amber: "bg-amber-500",
  purple: "bg-purple-500",
  red: "bg-red-500",
  pink: "bg-pink-500",
  slate: "bg-slate-500",
  indigo: "bg-indigo-500",
  violet: "bg-violet-500",
  orange: "bg-orange-500",
}

const VALID_COLORS = new Set(Object.keys(collectionColors))
const DEFAULT_COLOR = "emerald"

export function safeColor(color: string): string {
  return VALID_COLORS.has(color) ? color : DEFAULT_COLOR
}

export const collectionIcons: Record<string, React.ReactNode> = {
  lock: <Lock className="size-3 text-white" />,
  users: <Users className="size-3 text-white" />,
  package: <Package className="size-3 text-white" />,
  folder: <Package className="size-3 text-white" />,
}

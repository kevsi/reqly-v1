export interface KeyCombo {
  key: string
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
}

export interface ShortcutDef {
  id: string
  defaultKeys: KeyCombo
  description: string
  category: string
}

export const SHORTCUT_DEFS: ShortcutDef[] = [
  // Requêtes
  { id: "sendRequest", defaultKeys: { key: "Enter", ctrl: true }, description: "Exécuter la requête", category: "Requêtes" },
  { id: "saveRequest", defaultKeys: { key: "s", ctrl: true }, description: "Sauvegarder la requête", category: "Requêtes" },
  { id: "formatJson", defaultKeys: { key: "j", ctrl: true }, description: "Formater le JSON", category: "Requêtes" },

  // Navigation
  { id: "newTab", defaultKeys: { key: "t", ctrl: true }, description: "Nouvel onglet", category: "Navigation" },
  { id: "closeTab", defaultKeys: { key: "w", ctrl: true }, description: "Fermer l'onglet", category: "Navigation" },
  { id: "search", defaultKeys: { key: "k", ctrl: true }, description: "Recherche / Palette", category: "Navigation" },

  // Affichage
  { id: "toggleSidebar", defaultKeys: { key: "b", ctrl: true }, description: "Basculer la barre latérale", category: "Affichage" },
  { id: "toggleCollections", defaultKeys: { key: "e", ctrl: true }, description: "Basculer les collections", category: "Affichage" },
  { id: "toggleHistory", defaultKeys: { key: "h", ctrl: true }, description: "Basculer l'historique", category: "Affichage" },

  // Assistant IA
  { id: "openAI", defaultKeys: { key: "a", ctrl: true, shift: true }, description: "Ouvrir l'assistant IA", category: "Assistant IA" },
]

export function comboId(c: KeyCombo): string {
  const parts: string[] = []
  if (c.ctrl) parts.push("Ctrl")
  if (c.shift) parts.push("Shift")
  if (c.alt) parts.push("Alt")
  parts.push(c.key.charAt(0).toUpperCase() + c.key.slice(1))
  return parts.join("+")
}

export function comboEqual(a: KeyCombo, b: KeyCombo): boolean {
  return a.key.toLowerCase() === b.key.toLowerCase()
    && Boolean(a.ctrl) === Boolean(b.ctrl)
    && Boolean(a.shift) === Boolean(b.shift)
    && Boolean(a.alt) === Boolean(b.alt)
}

import { persistence } from "@/lib/persistence"

export const STORAGE_KEY = "reqly-custom-shortcuts"

export function loadCustomShortcuts(): Record<string, KeyCombo> {
  if (typeof window === "undefined") return {}
  try {
    const raw = persistence.getItem<string>(STORAGE_KEY)
    if (!raw) return {}
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

export function saveCustomShortcut(id: string, combo: KeyCombo): void {
  const all = loadCustomShortcuts()
  all[id] = combo
  void persistence.setItem(STORAGE_KEY, JSON.stringify(all))
}

export function resetCustomShortcut(id: string): void {
  const all = loadCustomShortcuts()
  delete all[id]
  void persistence.setItem(STORAGE_KEY, JSON.stringify(all))
}

export function resetAllCustomShortcuts(): void {
  void persistence.removeItem(STORAGE_KEY)
}

export function resolveCombo(id: string): KeyCombo {
  const def = SHORTCUT_DEFS.find((s) => s.id === id)
  if (!def) return { key: "" }
  const custom = loadCustomShortcuts()[id]
  return custom ?? def.defaultKeys
}

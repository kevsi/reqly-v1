"use client";

/**
 * Librairie locale des configs de mock (panneau « Gestion des configs »).
 * Persistance localStorage plafonnée : chaque génération IA ou sauvegarde
 * manuelle du brouillon y ajoute une entrée téléchargeable/réutilisable.
 */
import type { MockConfig } from "@reqly/mock-engine";

const SAVED_CONFIGS_KEY = "reqly-mocks-saved-configs";
const MAX_SAVED_CONFIGS = 20;

export interface SavedMockConfig {
  id: string;
  name: string;
  createdAt: string;
  source: "ai" | "draft" | "import";
  config: MockConfig;
}

function makeId(): string {
  return `cfg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function loadSavedConfigs(): SavedMockConfig[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SAVED_CONFIGS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is SavedMockConfig =>
        !!entry &&
        typeof entry === "object" &&
        typeof (entry as SavedMockConfig).id === "string" &&
        !!(entry as SavedMockConfig).config,
    );
  } catch {
    return [];
  }
}

function persist(list: SavedMockConfig[]): void {
  try {
    window.localStorage.setItem(SAVED_CONFIGS_KEY, JSON.stringify(list.slice(0, MAX_SAVED_CONFIGS)));
  } catch {
    /* quota / private mode — best effort */
  }
}

/** Ajoute (ou rafraîchit en tête si contenu identique) et retourne la liste à jour. */
export function addSavedConfig(config: MockConfig, source: SavedMockConfig["source"]): SavedMockConfig[] {
  const fingerprint = JSON.stringify(config.routes);
  const existing = loadSavedConfigs();
  const duplicate = existing.find((entry) => JSON.stringify(entry.config.routes) === fingerprint);
  const entry: SavedMockConfig = {
    id: duplicate?.id ?? makeId(),
    name: config.name?.trim() || `mock-${new Date().toISOString().slice(0, 10)}`,
    createdAt: new Date().toISOString(),
    source,
    config,
  };
  const next = [entry, ...existing.filter((e) => e.id !== entry.id)].slice(0, MAX_SAVED_CONFIGS);
  persist(next);
  return next;
}

export function removeSavedConfig(id: string): SavedMockConfig[] {
  const next = loadSavedConfigs().filter((entry) => entry.id !== id);
  persist(next);
  return next;
}

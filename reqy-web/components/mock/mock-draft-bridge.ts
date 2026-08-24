"use client";

/**
 * Pont entre le store local du brouillon mock (useMockRoutes, état React) et
 * les outils IA qui vivent hors React (lib/llm-tools). Le hook publie chaque
 * changement de config et enregistre son setter ; les outils lisent/écrivent
 * via ce module sans créer de dépendance circulaire.
 */
import type { MockConfig } from "@reqly/mock-engine";

let currentDraft: MockConfig | null = null;
let draftWriter: ((next: MockConfig) => void) | null = null;

export function publishMockDraft(config: MockConfig | null): void {
  currentDraft = config;
}

export function getMockDraft(): MockConfig | null {
  return currentDraft;
}

export function registerMockDraftWriter(write: ((next: MockConfig) => void) | null): void {
  draftWriter = write;
}

/** Écriture du brouillon par un outil autorisé (permission `ask` côté agent). */
export function writeMockDraft(next: MockConfig): boolean {
  if (!draftWriter) return false;
  draftWriter(next);
  currentDraft = next;
  return true;
}

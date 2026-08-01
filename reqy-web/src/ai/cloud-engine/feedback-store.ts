/**
 * Phase 7.3 — Feedback loop: diagnostic rating store
 *
 * Persists user ratings (thumbs up/down) per diagnostic id in
 * localStorage. Sync API on the module level so it's usable from
 * any component without a hook ceremony.
 */

import { persistence } from "@/lib/persistence";

export type Rating = "up" | "down" | null;

const STORAGE_KEY = "reqlyai.diagnostic-ratings";

interface RatingMap {
  [diagnosticId: string]: Rating;
}

function loadAll(): RatingMap {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = persistence.getItem<string>(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as RatingMap) : {};
  } catch {
    return {};
  }
}

function saveAll(map: RatingMap): void {
  if (typeof localStorage === "undefined") return;
  try {
    void persistence.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* quota or serialization issues — fail silent */
  }
}

/** Store or clear a rating for a diagnostic id. */
export function rateDiagnostic(diagnosticId: string, rating: Rating): void {
  const all = loadAll();
  if (rating === null) {
    delete all[diagnosticId];
  } else {
    all[diagnosticId] = rating;
  }
  saveAll(all);
}

/** Get the rating for a diagnostic id, or null. */
export function getRating(diagnosticId: string): Rating {
  return loadAll()[diagnosticId] ?? null;
}

/** Get all ratings (for stats / debugging). */
export function getAllRatings(): RatingMap {
  return loadAll();
}

/** Clear all ratings. */
export function clearRatings(): void {
  if (typeof localStorage === "undefined") return;
  try {
    void persistence.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Aggregate stats for reporting / dashboards.
 */
export interface RatingStats {
  total: number;
  up: number;
  down: number;
}

export function getRatingStats(): RatingStats {
  const all = loadAll();
  let up = 0;
  let down = 0;
  for (const r of Object.values(all)) {
    if (r === "up") up++;
    else if (r === "down") down++;
  }
  return { total: up + down, up, down };
}

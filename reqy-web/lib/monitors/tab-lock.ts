"use client";

/**
 * Verrou multi-onglets pour le scheduler des monitors : un seul onglet
 * « leader » exécute les déclenchements planifiés, évitant runs doublés et
 * courses d'écriture localStorage. Le heartbeat expire après 15 s (onglet
 * fermé / veille) → reprise automatique par un autre onglet.
 */
import { persistence } from "@/lib/persistence";

const LEADER_KEY = "reqly-monitors-leader";
const STALE_MS = 15_000;

interface LeaderState {
  tabId: string;
  at: number;
}

let myTabId: string | null = null;

function ensureTabId(): string {
  if (!myTabId) {
    myTabId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID().slice(0, 8)
        : Math.random().toString(36).slice(2, 10);
  }
  return myTabId;
}

function read(): LeaderState | null {
  try {
    return persistence.getItem<LeaderState>(LEADER_KEY) ?? null;
  } catch {
    return null;
  }
}

function write(state: LeaderState): void {
  try {
    void persistence.setItem(LeaderKeySafe(), state);
  } catch {
    /* private mode */
  }
}

function LeaderKeySafe(): string {
  return LEADER_KEY;
}

/** Tente de devenir leader (ou rafraîchit si déjà leader). Retourne le statut. */
export function acquireLeadership(): boolean {
  const now = Date.now();
  const current = read();
  const id = ensureTabId();
  if (!current || current.tabId === id || now - current.at > STALE_MS) {
    write({ tabId: id, at: now });
    return true;
  }
  return false;
}

/** À appeler périodiquement tant que l'onglet est vivant et leader. */
export function refreshLeadership(): boolean {
  const now = Date.now();
  const current = read();
  const id = ensureTabId();
  if (current?.tabId === id) {
    write({ tabId: id, at: now });
    return true;
  }
  if (!current || now - current.at > STALE_MS) {
    write({ tabId: id, at: now });
    return true;
  }
  return false;
}

export function releaseLeadership(): void {
  const current = read();
  if (current?.tabId === ensureTabId()) {
    try {
      void persistence.removeItem(LEADER_KEY);
    } catch {
      /* ignore */
    }
  }
}

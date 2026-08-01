"use client";

/**
 * Shared visibility state for the floating AI chat.
 *
 * Replaces the two `setInterval(check, 1000)` pollers that used to live in
 * `api-sidebar.tsx` and `floating-ai-chat.tsx`. Those pollers were wasteful
 * (1 Hz even when the tab is hidden) and racy (two timers could flip the
 * state independently).
 *
 * The hook is backed by `useSyncExternalStore` and listens for:
 *   - cross-tab `storage` events
 *   - a synthetic `storage` event we dispatch from `setAiChatHidden()` so
 *     same-tab subscribers wake up immediately (the native `storage` event
 *     only fires in OTHER tabs).
 *
 * Storage path: `localStorage["reqly-hide-ai-chat"]` (string "true" or
 * absent). Writes still go through `persistence.setItem` so the value is
 * mirrored to IndexedDB by `lib/persistence`.
 */

import { useSyncExternalStore } from "react";
import { persistence } from "@/lib/persistence";

export const AI_CHAT_HIDDEN_KEY = "reqly-hide-ai-chat";

function subscribe(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === AI_CHAT_HIDDEN_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): boolean {
  try {
    return window.localStorage.getItem(AI_CHAT_HIDDEN_KEY) === "true";
  } catch {
    return false;
  }
}

function getServerSnapshot(): boolean {
  // SSR safe default — the chat is visible by default until the user hides it.
  return false;
}

export function useAiChatHidden(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Persist the new visibility state and notify same-tab listeners.
 *
 * We dispatch a synthetic `StorageEvent` because the native one is spec'd
 * to fire only in tabs other than the one that made the change.
 */
export function setAiChatHidden(hidden: boolean): void {
  try {
    if (hidden) {
      void persistence.setItem(AI_CHAT_HIDDEN_KEY, "true");
    } else {
      void persistence.removeItem(AI_CHAT_HIDDEN_KEY);
    }
  } catch {
    // Persistence layer unavailable — the storage event below will still
    // broadcast the in-memory change to subscribers, but the value won't
    // survive a reload. That's acceptable for a UX toggle.
  }
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: AI_CHAT_HIDDEN_KEY,
      newValue: hidden ? "true" : null,
    }),
  );
}

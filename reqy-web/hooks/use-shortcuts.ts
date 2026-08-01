"use client";

import { useCallback, useMemo, useSyncExternalStore, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSidebar } from "@/contexts/sidebar-context";
import {
  type KeyCombo,
  SHORTCUT_DEFS,
  loadCustomShortcuts,
  saveCustomShortcut,
  resetCustomShortcut,
  resetAllCustomShortcuts,
} from "@/lib/shortcut-defs";
import { useKeyboardShortcuts, type KeyboardShortcut } from "./use-keyboard-shortcuts";

// ─── Reactive store subscription ────────────────────────────────────
// Must return a stable reference until the store actually changes,
// otherwise useSyncExternalStore re-renders infinitely.
let _cached: Record<string, KeyCombo> | null = null;

function getSnapshot(): Record<string, KeyCombo> {
  if (_cached === null) {
    _cached = loadCustomShortcuts();
  }
  return _cached;
}

function subscribeToShortcuts(cb: () => void): () => void {
  const handler = () => {
    _cached = null; // invalidate on next read
    cb();
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}

function invalidateCache(): void {
  _cached = null;
  window.dispatchEvent(new Event("storage"));
}

// ─── Actions ────────────────────────────────────────────────────────
function clickTestId(id: string): void {
  const el = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  el?.click();
}

// ─── Hook ───────────────────────────────────────────────────────────
type ShortcutActions = { router: ReturnType<typeof useRouter>; toggleSidebar: () => void };

export function useShortcuts() {
  const custom = useSyncExternalStore(subscribeToShortcuts, getSnapshot, getSnapshot);
  const router = useRouter();
  const { toggleSidebar } = useSidebar();
  // No render-time ref assignment here; ShortcutsRegistrar maintains the
  // stable ref for runtime actions.

  const getKeys = useCallback(
    (id: string): KeyCombo => {
      return custom[id] ?? SHORTCUT_DEFS.find((s) => s.id === id)?.defaultKeys ?? { key: "" };
    },
    [custom],
  );

  const setCustom = useCallback((id: string, combo: KeyCombo) => {
    saveCustomShortcut(id, combo);
    invalidateCache();
  }, []);

  const reset = useCallback((id: string) => {
    resetCustomShortcut(id);
    invalidateCache();
  }, []);

  const resetAll = useCallback(() => {
    resetAllCustomShortcuts();
    invalidateCache();
  }, []);

  return { custom, getKeys, setCustom, reset, resetAll };
}

// ─── Registrar component ───────────────────────────────────────────
export function ShortcutsRegistrar() {
  const { custom } = useShortcuts();

  const { toggleSidebar } = useSidebar();
  const router = useRouter();
  const actionRef = useRef<ShortcutActions>(null as unknown as ShortcutActions);
  useEffect(() => {
    actionRef.current = { router, toggleSidebar };
  }, [router, toggleSidebar]);

  const shortcuts = useMemo<KeyboardShortcut[]>(
    () =>
      SHORTCUT_DEFS.map((def): KeyboardShortcut => {
        const combo = custom[def.id] ?? def.defaultKeys;
        return {
          key: combo.key,
          ctrl: combo.ctrl,
          shift: combo.shift,
          alt: combo.alt,
          description: def.description,
          allowInInputs: def.id === "formatJson",
          action: () => {
            const { router, toggleSidebar } = actionRef.current;
            dispatchShortcutAction(def.id, { router, toggleSidebar });
          },
        };
      }),
    [custom],
  );

  useKeyboardShortcuts(shortcuts);
  return null;
}

function dispatchShortcutAction(id: string, deps: ShortcutActions): void {
  switch (id) {
    case "sendRequest":
      clickTestId("send-button");
      break;
    case "saveRequest":
      clickTestId("tabbar-save");
      break;
    case "formatJson":
      // Priority 1: format the request body textarea (REST JSON body)
      if (formatBodyTextarea()) break;
      // Priority 2: GraphQL prettify button
      clickTestId("graphql-prettify-button");
      break;
    case "newTab":
      clickTestId("tabbar-add-tab");
      break;
    case "closeTab":
      // Find the close button inside the active tab
      closeActiveTab();
      break;
    case "search":
      // Open search palette via the header search button
      clickTitle("Search (Ctrl+K)");
      break;
    case "toggleSidebar":
      deps.toggleSidebar();
      break;
    case "toggleCollections":
      clickTestId("tabbar-collections");
      break;
    case "toggleHistory":
      clickTestId("tabbar-history");
      break;
    case "openAI":
      clickTestId("btn-ai-open");
      break;
  }
}

/** Click an element by its `title` attribute. */
function clickTitle(title: string): void {
  document.querySelector<HTMLElement>(`[title="${title}"]`)?.click();
}

/** Format JSON in the request body textarea. Returns true if successful. */
function formatBodyTextarea(): boolean {
  const textarea = document.querySelector<HTMLTextAreaElement>(
    '[data-testid="request-body-textarea"]',
  );
  if (!textarea) return false;
  try {
    const parsed = JSON.parse(textarea.value);
    const formatted = JSON.stringify(parsed, null, 2);
    // React controlled input workaround: set native value then dispatch input event
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    if (nativeSetter) {
      nativeSetter.call(textarea, formatted);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }
    // Fallback: just replace the value directly
    textarea.value = formatted;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  } catch {
    return false;
  }
}

/** Close the currently active tab by clicking its × button. */
function closeActiveTab(): void {
  const tabs = document.querySelector('[data-testid="request-tabs"]');
  if (!tabs) return;
  // The active tab div has the classes "bg-background text-foreground"
  const activeTab = tabs.querySelector<HTMLElement>("div.bg-background.text-foreground");
  if (!activeTab) return;
  const closeBtn = activeTab.querySelector<HTMLElement>('[data-testid="tabbar-close-tab"]');
  closeBtn?.click();
}

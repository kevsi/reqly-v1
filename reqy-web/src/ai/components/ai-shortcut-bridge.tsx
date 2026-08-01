"use client";

/**
 * Global keyboard shortcut: Ctrl+Shift+A (or Cmd+Shift+A on Mac)
 * dispatches a "reqly:focus-ai" event that ChatPanel listens for.
 *
 * Rendered once at the root layout level so it works from any page.
 */
import { useGlobalShortcut } from "@/hooks/use-global-shortcut";

export const AI_FOCUS_EVENT = "reqly:focus-ai";

export function AiShortcutBridge() {
  useGlobalShortcut({ key: "a", ctrl: true, shift: true }, () => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(AI_FOCUS_EVENT));
  });
  return null;
}

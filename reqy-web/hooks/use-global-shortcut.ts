/**
 * Global keyboard shortcut listener.
 * Triggers the callback when the matching key combo is pressed,
 * ignoring when the user is typing in a form field (unless `allowInInputs`).
 */
"use client";

import { useEffect, useRef } from "react";

export interface ShortcutOptions {
  /** Key (case-insensitive): "a", "enter", "escape", "/", etc. */
  key: string;
  /** Require Ctrl / Cmd. */
  ctrl?: boolean;
  /** Require Shift. */
  shift?: boolean;
  /** Require Alt / Option. */
  alt?: boolean;
  /** Require Meta (Cmd on mac, Win key on Win). */
  meta?: boolean;
  /** Trigger even when focus is in an input/textarea. */
  allowInInputs?: boolean;
}

function isFormElement(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/**
 * useGlobalShortcut — registers a global keyboard listener.
 * `key` may be a single character (matched case-insensitively) or one of:
 *   "Enter", "Escape", "Tab", "Backspace", "ArrowUp/Down/Left/Right",
 *   "Space", "/", etc.
 */
export function useGlobalShortcut(
  options: ShortcutOptions,
  callback: (e: KeyboardEvent) => void,
): void {
  const cbRef = useRef(callback);
  // Keep latest callback in a ref outside of render lifecycle
  useEffect(() => {
    cbRef.current = callback;
  }, [callback]);

  useEffect(() => {
    const key = options.key.toLowerCase();
    function handler(e: KeyboardEvent) {
      const matches =
        e.key.toLowerCase() === key &&
        Boolean(options.ctrl) === (e.ctrlKey || e.metaKey) &&
        Boolean(options.shift) === e.shiftKey &&
        Boolean(options.alt) === e.altKey &&
        Boolean(options.meta) === e.metaKey;

      if (!matches) return;
      if (!options.allowInInputs && isFormElement(e.target)) return;

      e.preventDefault();
      cbRef.current(e);
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [options.key, options.ctrl, options.shift, options.alt, options.meta, options.allowInInputs]);
}

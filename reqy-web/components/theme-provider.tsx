"use client";

/**
 * ThemeProvider — single source of truth for the active theme.
 *
 * Why a custom implementation instead of `next-themes`?
 *   - We need <7> named themes (not just light/dark) that map 1:1 to CSS
 *     classes defined in `app/globals.css`.
 *   - We need live OS theme tracking via `prefers-color-scheme` so users
 *     who haven't picked an explicit theme see their system preference
 *     reflected immediately when it changes.
 *   - We need cross-component, cross-tab synchronisation without polling.
 *
 * Storage:
 *   - `localStorage["reqly-theme"]` is the SINGLE source of truth (mirrored
 *     to IndexedDB by `lib/persistence` for backup, but never read back via
 *     the persistence layer here — that was the cause of B1 in the plan:
 *     the inline head script and `persistence.getItem` could diverge).
 *   - The inline `<head>` script in `app/layout.tsx` is kept as a FOUC net
 *     for users with JS disabled or slow hydration.
 *
 * Hydration:
 *   - `<html>` already has `suppressHydrationWarning`. The inline script
 *     sets the correct class on `<html>` before React boots.
 *   - `useSyncExternalStore` calls `getServerSnapshot()` (returns
 *     DEFAULT_THEME) during SSR, then `getSnapshot()` (returns the stored
 *     value) on the first client commit. React uses the client value, so
 *     `useTheme()` consumers see the correct theme on first paint with no
 *     intermediate "light" flash.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

export type Theme = "light" | "dark" | "emerald" | "ocean" | "sunset" | "purple" | "midnight";

export const THEMES = [
  "light",
  "dark",
  "emerald",
  "ocean",
  "sunset",
  "purple",
  "midnight",
] as const satisfies readonly Theme[];

export const DEFAULT_THEME: Theme = "light";
export const THEME_STORAGE_KEY = "reqly-theme";
/** Custom event used to notify same-tab listeners after `setTheme()`. */
export const THEME_CHANGE_EVENT = "reqly:theme-change";

function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

function readStoredTheme(): Theme | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(raw) ? raw : null;
  } catch {
    return null;
  }
}

function readSystemTheme(): Theme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return DEFAULT_THEME;
  }
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return DEFAULT_THEME;
  }
}

function resolveTheme(): Theme {
  return readStoredTheme() ?? readSystemTheme();
}

/** Apply the theme class to <html> + update color-scheme / theme-color meta. */
function applyThemeToDom(theme: Theme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  // Remove every known theme class before adding the new one.
  for (const t of THEMES) root.classList.remove(t);
  root.classList.add(theme);

  // Midnight is a dark theme but is NOT the `.dark` class. Tailwind's dark
  // variant (`@custom-variant dark`) only matches `.dark`, so we must also
  // add `.dark` alongside `.midnight` or every `dark:*` utility stays inert
  // (components would keep their light-theme colors in midnight mode).
  if (theme === "midnight") root.classList.add("dark");

  const isDark = theme === "dark" || theme === "midnight";
  root.style.colorScheme = isDark ? "dark" : "light";

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute("content", isDark ? "#0a0a0b" : "#ffffff");
  }
}

// ── useSyncExternalStore plumbing ─────────────────────────────────────

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  // Cross-tab sync (storage events only fire in OTHER tabs/windows).
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);

  // OS theme tracking.
  let mql: MediaQueryList | null = null;
  const onMqChange = () => listener();
  if (typeof window.matchMedia === "function") {
    mql = window.matchMedia("(prefers-color-scheme: dark)");
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onMqChange);
    } else if (typeof mql.addListener === "function") {
      // Safari < 14 fallback.
      mql.addListener(onMqChange);
    }
  }

  // Same-tab programmatic changes (setTheme dispatches this).
  const onLocalChange = () => listener();
  window.addEventListener(THEME_CHANGE_EVENT, onLocalChange);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(THEME_CHANGE_EVENT, onLocalChange);
    if (mql) {
      if (typeof mql.removeEventListener === "function") {
        mql.removeEventListener("change", onMqChange);
      } else if (typeof mql.removeListener === "function") {
        mql.removeListener(onMqChange);
      }
    }
  };
}

function getSnapshot(): Theme {
  return resolveTheme();
}

function getServerSnapshot(): Theme {
  // Safe default for SSR — the inline <head> script + suppressHydrationWarning
  // ensure no visible mismatch on the first paint.
  return DEFAULT_THEME;
}

// ── Context ───────────────────────────────────────────────────────────

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Defensive sync: the inline <head> script already sets the right class
  // before hydration, but the OS theme can change between page-load and
  // React mount (rare but possible on slow devices). Re-applying here is
  // cheap (idempotent class manipulation).
  useEffect(() => {
    applyThemeToDom(theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // localStorage may be unavailable (private browsing, quota). The
      // theme will still apply for the current session via applyThemeToDom.
    }
    applyThemeToDom(next);
    // `storage` events don't fire in the same tab, so we dispatch a custom
    // event to wake up any other `useSyncExternalStore` consumers in this tab.
    window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT));
  }, []);

  const value = useMemo<ThemeContextValue>(() => ({ theme, setTheme }), [theme, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}

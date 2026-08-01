import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import {
  ThemeProvider,
  useTheme,
  THEMES,
  THEME_STORAGE_KEY,
  THEME_CHANGE_EVENT,
} from "@/components/theme-provider";

/**
 * Tests for the rewritten ThemeProvider.
 *
 * Goals covered (Chunk 1 of the plan):
 *   - localStorage is the single source of truth (no `persistence` indirection)
 *   - `useTheme().theme` reflects the stored value on first client commit
 *   - `setTheme` writes to localStorage AND dispatches the custom event so
 *     other `useSyncExternalStore` consumers in the same tab wake up
 *   - Falls back to `prefers-color-scheme` when nothing is stored
 *   - Returns the stored value when it exists, even if it differs from system
 */

function clearStorage() {
  localStorage.clear();
}

function setStoredTheme(theme: string) {
  localStorage.setItem(THEME_STORAGE_KEY, theme);
}

describe("ThemeProvider", () => {
  let matchMediaListeners: Array<(e: MediaQueryListEvent) => void>;
  let matchMediaMatches: boolean;

  beforeEach(() => {
    clearStorage();
    matchMediaListeners = [];
    matchMediaMatches = false;
    matchMediaMatches = false;

    // jsdom doesn't implement matchMedia — stub it.
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: matchMediaMatches,
        media: query,
        onchange: null,
        addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => {
          matchMediaListeners.push(cb);
        },
        removeEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => {
          matchMediaListeners = matchMediaListeners.filter((l) => l !== cb);
        },
        addListener: (cb: (e: MediaQueryListEvent) => void) => {
          matchMediaListeners.push(cb);
        },
        removeListener: (cb: (e: MediaQueryListEvent) => void) => {
          matchMediaListeners = matchMediaListeners.filter((l) => l !== cb);
        },
        dispatchEvent: () => true,
      })),
    });

    // Reset <html> classes between tests.
    document.documentElement.className = "";
    document.documentElement.style.colorScheme = "";
  });

  afterEach(() => {
    document.documentElement.className = "";
    document.documentElement.style.colorScheme = "";
    clearStorage();
  });

  it("returns DEFAULT_THEME when nothing is stored and system is light", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ThemeProvider>{children}</ThemeProvider>
    );
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.theme).toBe("light");
  });

  it("returns 'dark' from localStorage when stored, ignoring system preference", () => {
    matchMediaMatches = false; // system = light, but stored = dark
    setStoredTheme("dark");
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ThemeProvider>{children}</ThemeProvider>
    );
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.theme).toBe("dark");
  });

  it("falls back to system 'dark' when nothing is stored and OS prefers dark", () => {
    matchMediaMatches = true;
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ThemeProvider>{children}</ThemeProvider>
    );
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.theme).toBe("dark");
  });

  it("ignores invalid stored values and falls back to system", () => {
    matchMediaMatches = false;
    localStorage.setItem(THEME_STORAGE_KEY, "not-a-real-theme");
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ThemeProvider>{children}</ThemeProvider>
    );
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.theme).toBe("light");
  });

  it("setTheme persists to localStorage and notifies same-tab listeners", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ThemeProvider>{children}</ThemeProvider>
    );
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.theme).toBe("light");

    act(() => {
      result.current.setTheme("emerald");
    });

    expect(result.current.theme).toBe("emerald");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("emerald");
  });

  it("setTheme applies the class to <html>", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ThemeProvider>{children}</ThemeProvider>
    );
    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => {
      result.current.setTheme("midnight");
    });

    expect(document.documentElement.classList.contains("midnight")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("midnight also adds the .dark class so Tailwind dark: variants fire", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ThemeProvider>{children}</ThemeProvider>
    );
    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => {
      result.current.setTheme("midnight");
    });

    expect(document.documentElement.classList.contains("midnight")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("light themes do NOT add the .dark class", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ThemeProvider>{children}</ThemeProvider>
    );
    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => {
      result.current.setTheme("emerald");
    });

    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("setTheme removes every other theme class before adding the new one", () => {
    document.documentElement.classList.add("light", "dark", "emerald");
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ThemeProvider>{children}</ThemeProvider>
    );
    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => {
      result.current.setTheme("ocean");
    });

    expect(document.documentElement.classList.contains("ocean")).toBe(true);
    for (const t of THEMES) {
      if (t !== "ocean") {
        expect(document.documentElement.classList.contains(t)).toBe(false);
      }
    }
  });

  it("reacts to storage events from other tabs", () => {
    setStoredTheme("light");
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ThemeProvider>{children}</ThemeProvider>
    );
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.theme).toBe("light");

    act(() => {
      setStoredTheme("purple");
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: THEME_STORAGE_KEY,
          newValue: "purple",
        }),
      );
    });

    expect(result.current.theme).toBe("purple");
  });

  it("reacts to prefers-color-scheme changes when nothing is stored", () => {
    matchMediaMatches = false;
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ThemeProvider>{children}</ThemeProvider>
    );
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.theme).toBe("light");

    act(() => {
      matchMediaMatches = true;
      for (const cb of matchMediaListeners) {
        cb({} as MediaQueryListEvent);
      }
    });

    expect(result.current.theme).toBe("dark");
  });

  it("reacts to the local THEME_CHANGE_EVENT", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ThemeProvider>{children}</ThemeProvider>
    );
    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => {
      setStoredTheme("sunset");
      window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT));
    });

    expect(result.current.theme).toBe("sunset");
  });

  it("useTheme throws when called outside a ThemeProvider", () => {
    expect(() => renderHook(() => useTheme())).toThrow(
      /useTheme must be used within a ThemeProvider/,
    );
  });

  it("renders children without crashing", () => {
    render(
      <ThemeProvider>
        <div data-testid="child">hello</div>
      </ThemeProvider>,
    );
    expect(screen.getByTestId("child").textContent).toBe("hello");
  });
});

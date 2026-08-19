import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useIsMobile } from "@/hooks/use-mobile";

type Listener = (event: MediaQueryListEvent) => void;

describe("useIsMobile", () => {
  let matches = false;
  let listeners: Listener[] = [];

  beforeEach(() => {
    matches = false;
    listeners = [];
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches,
        media: query,
        onchange: null,
        addEventListener: (_event: string, listener: Listener) => {
          listeners.push(listener);
        },
        removeEventListener: (_event: string, listener: Listener) => {
          listeners = listeners.filter((current) => current !== listener);
        },
        addListener: (listener: Listener) => {
          listeners.push(listener);
        },
        removeListener: (listener: Listener) => {
          listeners = listeners.filter((current) => current !== listener);
        },
        dispatchEvent: () => true,
      })),
    });
  });

  it("uses the actual desktop viewport instead of a forced mobile fallback", () => {
    matches = false;
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it("uses the actual mobile viewport on the first client render", () => {
    matches = true;
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it("updates when the viewport crosses the breakpoint", () => {
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    act(() => {
      matches = true;
      for (const listener of listeners) listener({} as MediaQueryListEvent);
    });

    expect(result.current).toBe(true);
  });
});

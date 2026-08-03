import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import {
  useEnabledModuleNav,
  useIsModuleEnabled,
  installModule,
  uninstallModule,
  setModuleEnabled,
} from "@/hooks/use-modules-store";
import { getAvailableModules } from "@/lib/modules/registry";

describe("module store reactive selectors", () => {
  beforeEach(() => {
    localStorage.clear();
    for (const m of getAvailableModules()) uninstallModule(m.id);
  });
  afterEach(() => cleanup());

  it("useEnabledModuleNav returns no nav when nothing is installed", () => {
    const { result } = renderHook(() => useEnabledModuleNav());
    expect(result.current).toEqual([]);
  });

  it("useEnabledModuleNav returns the encode-decode nav after install (enabled by default)", () => {
    act(() => installModule("encode-decode"));
    const { result } = renderHook(() => useEnabledModuleNav());
    expect(result.current).toHaveLength(1);
    expect(result.current[0]).toMatchObject({ label: "Encodeur", href: "/encode-decode/" });
  });

  it("useIsModuleEnabled reflects install and disable", () => {
    const { result } = renderHook(() => useIsModuleEnabled("encode-decode"));
    expect(result.current).toBe(false);
    act(() => installModule("encode-decode"));
    expect(result.current).toBe(true);
    act(() => setModuleEnabled("encode-decode", false));
    expect(result.current).toBe(false);
  });
});

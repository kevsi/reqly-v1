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

  it("useEnabledModuleNav returns MTN nav after install (enabled by default)", () => {
    act(() => installModule("mtn-momo"));
    const { result } = renderHook(() => useEnabledModuleNav());
    expect(result.current).toHaveLength(1);
    expect(result.current[0]).toMatchObject({ label: "Mobile Money", href: "/mobile-money/" });
  });

  it("useIsModuleEnabled reflects install and disable", () => {
    const { result } = renderHook(() => useIsModuleEnabled("mtn-momo"));
    expect(result.current).toBe(false);
    act(() => installModule("mtn-momo"));
    expect(result.current).toBe(true);
    act(() => setModuleEnabled("mtn-momo", false));
    expect(result.current).toBe(false);
  });
});

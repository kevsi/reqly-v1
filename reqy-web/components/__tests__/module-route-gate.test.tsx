import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ModuleRouteGate } from "@/components/modules/module-route-gate";
import { getAvailableModules } from "@/lib/modules/registry";
import { installModule, uninstallModule } from "@/hooks/use-modules-store";

describe("ModuleRouteGate", () => {
  beforeEach(() => {
    localStorage.clear();
    for (const m of getAvailableModules()) uninstallModule(m.id);
  });
  afterEach(() => cleanup());

  it("shows a disabled notice (no children) when the module is not enabled", () => {
    render(
      <ModuleRouteGate moduleId="mtn-momo">
        <div data-testid="child">contenu protégé</div>
      </ModuleRouteGate>,
    );
    expect(screen.getByTestId("module-disabled")).toBeTruthy();
    expect(screen.queryByTestId("child")).toBeNull();
    expect(screen.getByText(/n'est pas activé/i)).toBeTruthy();
    const link = screen.getByRole("link", { name: /Activer le module/i });
    expect(link.getAttribute("href")).toBe("/settings/modules");
  });

  it("renders children when the module is enabled", () => {
    installModule("mtn-momo");
    render(
      <ModuleRouteGate moduleId="mtn-momo">
        <div data-testid="child">contenu protégé</div>
      </ModuleRouteGate>,
    );
    expect(screen.queryByTestId("module-disabled")).toBeNull();
    expect(screen.getByTestId("child")).toBeTruthy();
  });
});

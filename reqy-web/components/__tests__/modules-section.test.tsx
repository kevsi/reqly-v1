import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ModulesSection } from "@/components/settings/sections/modules-section";
import { getAvailableModules } from "@/lib/modules/registry";
import { uninstallModule } from "@/hooks/use-modules-store";

describe("ModulesSection", () => {
  beforeEach(() => {
    localStorage.clear();
    for (const m of getAvailableModules()) uninstallModule(m.id);
  });
  afterEach(() => cleanup());

  it("lists available modules with their description", () => {
    render(<ModulesSection />);
    expect(screen.getByRole("heading", { name: "Modules" })).toBeTruthy();
    // MTN MoMo is the only module seeded as available by default.
    expect(screen.getByText("MTN MoMo")).toBeTruthy();
    expect(screen.getByText(/Mobile Money callback simulator/)).toBeTruthy();
  });

  it("installs a module and reveals the enable switch", () => {
    render(<ModulesSection />);
    const installBtn = screen.getByRole("button", { name: "Installer" });
    fireEvent.click(installBtn);
    // A freshly installed module is enabled by default.
    const enableSwitch = screen.getByRole("switch");
    expect(enableSwitch.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("button", { name: "Désinstaller" })).toBeTruthy();
  });

  it("toggles the enable switch off and back on", () => {
    render(<ModulesSection />);
    fireEvent.click(screen.getByRole("button", { name: "Installer" }));
    const enableSwitch = screen.getByRole("switch");
    fireEvent.click(enableSwitch);
    expect(enableSwitch.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(enableSwitch);
    expect(enableSwitch.getAttribute("aria-checked")).toBe("true");
  });
});

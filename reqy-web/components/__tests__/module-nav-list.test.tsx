import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ModuleNavList } from "@/components/modules/module-nav-list";
import { getAvailableModules } from "@/lib/modules/registry";
import { installModule, uninstallModule } from "@/hooks/use-modules-store";

describe("ModuleNavList", () => {
  beforeEach(() => {
    localStorage.clear();
    for (const m of getAvailableModules()) uninstallModule(m.id);
  });
  afterEach(() => cleanup());

  it("renders nothing when no module is enabled", () => {
    const { container } = render(<ModuleNavList activePage="api-endpoints" collapsed={false} />);
    expect(container.querySelector("li")).toBeNull();
    expect(screen.queryByText("Mobile Money")).toBeNull();
  });

  it("renders an enabled module's nav entry with the right href", () => {
    installModule("mtn-momo");
    render(<ModuleNavList activePage="api-endpoints" collapsed={false} />);
    const link = screen.getByRole("link", { name: "Mobile Money" });
    // next/link normalises the trailing slash from the manifest href.
    expect(link.getAttribute("href")).toBe("/mobile-money");
  });

  it("marks the nav entry active when its route is active", () => {
    installModule("mtn-momo");
    render(<ModuleNavList activePage="mobile-money" collapsed={false} />);
    const link = screen.getByRole("link", { name: "Mobile Money" });
    expect(link.getAttribute("aria-current")).toBe("page");
  });
});

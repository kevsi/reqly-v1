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
    expect(screen.queryByText("Encodeur")).toBeNull();
  });

  it("renders an enabled module's nav entry with the right href", () => {
    installModule("encode-decode");
    render(<ModuleNavList activePage="api-endpoints" collapsed={false} />);
    const link = screen.getByRole("link", { name: "Encodeur" });
    // next/link normalises the trailing slash from the manifest href.
    expect(link.getAttribute("href")).toBe("/encode-decode");
  });

  it("marks the nav entry active when its route is active", () => {
    installModule("encode-decode");
    render(<ModuleNavList activePage="encode-decode" collapsed={false} />);
    const link = screen.getByRole("link", { name: "Encodeur" });
    expect(link.getAttribute("aria-current")).toBe("page");
  });
});

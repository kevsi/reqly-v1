import { describe, it, expect } from "vitest";
import {
  registerAvailableModule,
  getAvailableModules,
  installModule,
  uninstallModule,
  isInstalled,
  setModuleEnabled,
  getInstalledModules,
  getEnabledModules,
  getModuleNavItems,
  getModuleRoutes,
  getModuleById,
} from "@/lib/modules/registry";
import type { ModuleManifest, ModuleNavItem, ModuleRouteContribution } from "@/lib/modules/types";

// Two extra manifests (NOT extracted from core yet) used only to prove the
// contract is general and MTN MoMo is not special-cased.
const templatesModule: ModuleManifest = {
  id: "templates",
  name: "Templates & Recipes",
  version: "0.1.0",
  kind: "content",
  description: "Community request templates.",
};

const sdkModule: ModuleManifest = {
  id: "sdk-generate",
  name: "SDK Generator",
  version: "0.1.0",
  kind: "feature",
  nav: [{ label: "SDKs", href: "/sdks/" }],
  routes: [
    { path: "/sdks/", type: "page" },
    { path: "/api/sdk-generate", type: "api" },
  ],
};

describe("module registry (generalized contract)", () => {
  it("has MTN MoMo available — no special case", () => {
    const ids = getAvailableModules().map((m) => m.id);
    expect(ids).toContain("mtn-momo");
  });

  it("starts with no module installed/enabled", () => {
    expect(getInstalledModules()).toHaveLength(0);
    expect(getEnabledModules()).toHaveLength(0);
    expect(getModuleNavItems()).toHaveLength(0);
    expect(getModuleRoutes()).toHaveLength(0);
    expect(isInstalled("mtn-momo")).toBe(false);
  });

  it("installs + enables MTN MoMo uniformly (surfaces nav + route)", () => {
    installModule("mtn-momo");
    expect(isInstalled("mtn-momo")).toBe(true);
    expect(getEnabledModules().map((m) => m.id)).toEqual(["mtn-momo"]);

    const nav: ModuleNavItem[] = getModuleNavItems();
    expect(nav).toEqual([{ label: "Mobile Money", href: "/mobile-money/", icon: "Smartphone" }]);

    const routes: ModuleRouteContribution[] = getModuleRoutes();
    expect(routes).toEqual([{ path: "/mobile-money/", type: "page" }]);
  });

  it("can disable without uninstalling", () => {
    setModuleEnabled("mtn-momo", false);
    expect(isInstalled("mtn-momo")).toBe(true);
    expect(getEnabledModules()).toHaveLength(0);
    expect(getModuleNavItems()).toHaveLength(0);
  });

  it("uninstalls back to a clean state", () => {
    uninstallModule("mtn-momo");
    expect(isInstalled("mtn-momo")).toBe(false);
    expect(getInstalledModules()).toHaveLength(0);
  });

  it("handles other module kinds uniformly (contract is general)", () => {
    registerAvailableModule(templatesModule);
    registerAvailableModule(sdkModule);

    installModule("mtn-momo");
    installModule("templates");
    installModule("sdk-generate");

    // content module contributes no nav; feature module does
    const labels = getModuleNavItems()
      .map((n) => n.label)
      .sort();
    expect(labels).toEqual(["Mobile Money", "SDKs"]);

    // routes aggregate across kinds (page + api)
    const paths = getModuleRoutes()
      .map((r) => r.path)
      .sort();
    expect(paths).toEqual(["/api/sdk-generate", "/mobile-money/", "/sdks/"]);
  });

  it("looks up a module by id", () => {
    expect(getModuleById("mtn-momo")?.name).toBe("MTN MoMo");
    expect(getModuleById("does-not-exist")).toBeUndefined();
  });
});

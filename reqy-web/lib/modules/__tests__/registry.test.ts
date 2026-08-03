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

// An extra manifest (NOT extracted from core yet) used only to prove the
// contract is general and first-party modules are not special-cased.
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
  it("seeds the first-party modules", () => {
    const ids = getAvailableModules().map((m) => m.id);
    expect(ids).toEqual(["encode-decode"]);
  });

  it("starts with no module installed/enabled", () => {
    expect(getInstalledModules()).toHaveLength(0);
    expect(getEnabledModules()).toHaveLength(0);
    expect(getModuleNavItems()).toHaveLength(0);
    expect(getModuleRoutes()).toHaveLength(0);
    expect(isInstalled("encode-decode")).toBe(false);
  });

  it("installs + enables a module uniformly (surfaces nav + route)", () => {
    installModule("encode-decode");
    expect(isInstalled("encode-decode")).toBe(true);
    expect(getEnabledModules().map((m) => m.id)).toEqual(["encode-decode"]);

    const nav: ModuleNavItem[] = getModuleNavItems();
    expect(nav).toEqual([{ label: "Encodeur", href: "/encode-decode/", icon: "Binary" }]);

    const routes: ModuleRouteContribution[] = getModuleRoutes();
    expect(routes).toEqual([{ path: "/encode-decode/", type: "page" }]);
  });

  it("can disable without uninstalling", () => {
    setModuleEnabled("encode-decode", false);
    expect(isInstalled("encode-decode")).toBe(true);
    expect(getEnabledModules()).toHaveLength(0);
    expect(getModuleNavItems()).toHaveLength(0);
  });

  it("uninstalls back to a clean state", () => {
    uninstallModule("encode-decode");
    expect(isInstalled("encode-decode")).toBe(false);
    expect(getInstalledModules()).toHaveLength(0);
  });

  it("handles other module kinds uniformly (contract is general)", () => {
    registerAvailableModule(templatesModule);
    registerAvailableModule(sdkModule);

    installModule("encode-decode");
    installModule("templates");
    installModule("sdk-generate");

    // content module contributes no nav; feature modules do
    const labels = getModuleNavItems()
      .map((n) => n.label)
      .sort();
    expect(labels).toEqual(["Encodeur", "SDKs"]);

    // routes aggregate across kinds (page + api)
    const paths = getModuleRoutes()
      .map((r) => r.path)
      .sort();
    expect(paths).toEqual(["/api/sdk-generate", "/encode-decode/", "/sdks/"]);
  });

  it("looks up a module by id", () => {
    expect(getModuleById("encode-decode")?.name).toBe("Encodeur / Décodeur");
    expect(getModuleById("does-not-exist")).toBeUndefined();
  });
});

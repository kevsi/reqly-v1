import type { ModuleManifest } from "@/lib/modules/types";

/**
 * MTN MoMo module manifest.
 *
 * Declares what the module is and contributes. It is NOT special-cased: like
 * any other module it is available but not installed by default. Installing +
 * enabling it (and wiring the app to read the registry) surfaces its nav entry
 * and mounts its `/mobile-money/` page.
 */
export const mobileMoneyManifest: ModuleManifest = {
  id: "mtn-momo",
  name: "MTN MoMo",
  version: "0.1.0",
  description: "Mobile Money callback simulator (MTN MoMo, FedaPay, Kkiapay).",
  author: "Reqly",
  kind: "feature",
  nav: [{ label: "Mobile Money", href: "/mobile-money/", icon: "Smartphone" }],
  routes: [{ path: "/mobile-money/", type: "page" }],
};

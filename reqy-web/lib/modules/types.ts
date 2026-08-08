/**
 * Module contract — shared types for Reqly modules.
 *
 * A module is a self-contained feature that is NOT part of the generic
 * international app core. Every module — Encodeur/Décodeur, SDK generator,
 * Templates, … — is described by the SAME {@link ModuleManifest}
 * and managed uniformly through the registry (available → installed → enabled).
 * There is no special case for any module.
 *
 * The manifest declares WHAT the module is and what it contributes (nav,
 * routes). Whether it is actually surfaced in the app is a separate
 * install/enabled state held by the registry — not by the manifest.
 */

export type ModuleKind = "feature" | "content" | "integration";

export interface ModuleNavItem {
  /** Sidebar label, e.g. "Encodeur". */
  label: string;
  /** Route path the module is mounted at, e.g. "/encode-decode/". */
  href: string;
  /** Icon key (resolved by the sidebar when wiring happens). */
  icon?: string;
}

export interface ModuleRouteContribution {
  /** Route path the module owns, e.g. "/encode-decode/" or "/api/sdk-generate". */
  path: string;
  /** "page" = a UI route (app page); "api" = an API route handler. */
  type: "page" | "api";
}

export interface ModuleManifest {
  /** Unique, stable id (slug). Used as the lookup key and in URLs. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Semver string. */
  version: string;
  /** Short description for the module catalog / marketplace. */
  description?: string;
  /** Module author / maintainer. */
  author?: string;
  /** What kind of module this is (drives how the app surfaces it). */
  kind: ModuleKind;
  /** Sidebar contributions (feature modules). Shown only when enabled. */
  nav?: ModuleNavItem[];
  /** Routes (pages and/or API handlers) this module owns. */
  routes?: ModuleRouteContribution[];
  /** i18n namespace key for the module's translations. */
  i18nNamespace?: string;
}

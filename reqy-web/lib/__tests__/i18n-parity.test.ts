// @vitest-environment node
/**
 * Guards for the i18n locale files (src/i18n/locales/{fr,en}.json).
 *
 * Catches the regressions that previously shipped undetected:
 *  - a key used in code but missing from the locales (renders the literal key);
 *  - French text leaking into the English file;
 *  - incomplete plural pairs (`_one` without `_other` and vice versa);
 *  - FR/EN key drift.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import fr from "@/src/i18n/locales/fr.json";
import en from "@/src/i18n/locales/en.json";

type Json = Record<string, unknown>;

function flatten(
  obj: Json,
  prefix = "",
  out: Record<string, unknown> = {},
): Record<string, unknown> {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "object" && v !== null && !Array.isArray(v)) flatten(v as Json, key, out);
    else out[key] = v;
  }
  return out;
}

const frFlat = flatten(fr);
const enFlat = flatten(en);
const frKeys = Object.keys(frFlat).sort();
const enKeys = Object.keys(enFlat).sort();

const PLURAL_SUFFIX = /_(one|other|zero|few|many|two)$/;

/**
 * Values that legitimately stay identical in FR and EN: technical terms, brand
 * names, protocol words, format placeholders and interpolated fragments.
 * Adding a new entry here is a conscious decision — the "identical values"
 * test fails on anything not listed.
 */
const ALLOWED_IDENTICAL = new Set([
  " + ",
  "({{count}})",
  "OK",
  "Stash",
  "Min / Max",
  "origin",
  "https://github.com/user/repo.git",
  "API Endpoints",
  "Animations",
  "Arguments",
  "Assertion",
  "Assertions",
  "Audio",
  "Auth",
  "Base",
  "Base URL",
  "Bad Gateway (502)",
  "Gateway Timeout (504)",
  "Base64",
  "Base64 : {{size}} Ko",
  "Base64 · URL · Hex · JSON · HTML · CSV",
  "Basic Auth",
  "Bearer Token",
  "Body",
  "Capture",
  "Captures",
  "Force push",
  "Claude Opus, Sonnet, Haiku",
  "Code",
  "Collection",
  "Collection {{framework}} · {{name}}",
  "Collections",
  "Cookies",
  "DNS",
  "DeepSeek Chat, Coder",
  "Description",
  "Diff",
  "Documentation",
  "Endpoint",
  "Email",
  "Endpoints",
  "Fetch",
  "Form Data",
  "Framework",
  "GPT-4, GPT-4o, GPT-4o Mini",
  "Gemini 2.5 Pro, Flash",
  "Git",
  "GraphQL",
  "Grok-2, Grok-3 (xAI)",
  "HTML",
  "Headers",
  "ISO 8601 / UTC",
  "Image",
  "JS Fetch",
  "JSON",
  "JWT",
  "Middleware",
  "Module {{name}}",
  "Modules",
  "Navigation",
  "Notifications",
  "Nullable",
  "OAuth 2.0",
  "OK",
  "Options",
  "Pause",
  "PDF",
  "Payload",
  "Plan",
  "Port",
  "Conversations",
  "Routes",
  "Runner",
  "Resume",
  "SDK client",
  "SDKs",
  "SSE",
  "Snapshots",
  "Sync MCP",
  "TTFB",
  "Tests",
  "Total",
  "Transformer",
  "Type",
  "TypeScript",
  "Variable",
  "Variables",
  "Workspace",
  "XML",
  '[{"id":1,"nom":"A"},{"id":2,"nom":"B"}]',
  "cURL",
  "https://api.example.com/graphql",
  "id,nom\n1,A\n2,B",
  "ms",
  "variable",
  "x-www-form",
  '{ "Authorization": "Bearer token" }',
  '{ "id": 1 }',
  "{{count}} collection",
  "{{count}} collection(s)",
  "{{count}} collections",
  "{{count}} cookie",
  "{{count}} cookies",
  "{{count}} endpoint",
  "{{count}} endpoints",
  "{{count}} route",
  "{{count}} routes",
  "{{count}} var",
  "{{from}} → {{to}}",
  "{{size}} Ko",
  "— {{count}} variable",
  "— {{count}} variables",
  "← {{value}}",
  "→ {{value}}",
]);

describe("i18n locale parity (fr.json / en.json)", () => {
  it("has identical key sets in both files", () => {
    const frOnly = frKeys.filter((k) => !(k in enFlat));
    const enOnly = enKeys.filter((k) => !(k in frFlat));
    expect(frOnly).toEqual([]);
    expect(enOnly).toEqual([]);
  });

  it("keeps plural pairs complete (_one/_other)", () => {
    const bases = new Set<string>();
    for (const key of [...frKeys, ...enKeys]) {
      const base = key.replace(PLURAL_SUFFIX, "");
      if (base !== key) bases.add(base);
    }
    const missing: string[] = [];
    for (const base of bases) {
      if (!(base + "_one" in frFlat) || !(base + "_other" in frFlat)) missing.push(`fr:${base}`);
      if (!(base + "_one" in enFlat) || !(base + "_other" in enFlat)) missing.push(`en:${base}`);
    }
    expect(missing).toEqual([]);
  });

  it("does not leak French into the English file", () => {
    // 1) Accent heuristic
    const accented = Object.entries(enFlat)
      .filter(([k, v]) => /[àâäéèêëîïôöùûüçœ]/.test(String(v)) && k !== "language.fr")
      .map(([k, v]) => `${k}: ${String(v)}`);
    expect(accented).toEqual([]);

    // 2) French stopwords without accents (catches e.g. "Aucune variable", "historique")
    const stopword =
      /(^|\s)(un|une|des|les|aux|du|dans|pour|avec|sur|par|pas|plus|aucun|aucune|votre|vous|êtes|être|voulez|ajouté|ajoutée|supprimé|annuler|rechercher|cette|ces|qui|que|quand|comment|pourquoi|créer|fermer|continuer|réessayer|historique|français|cliquez|sélectionnez)(\s|$)/i;
    const leaks = Object.entries(enFlat)
      .filter(([, v]) => stopword.test(String(v)) && !ALLOWED_IDENTICAL.has(String(v)))
      .map(([k, v]) => `${k}: ${String(v)}`);
    expect(leaks).toEqual([]);
  });

  it("only keeps identical FR/EN values that are listed in the allowlist", () => {
    const identical = frKeys.filter((k) => frFlat[k] === enFlat[k]);
    const unlisted = identical.filter((k) => !ALLOWED_IDENTICAL.has(String(frFlat[k])));
    expect(unlisted).toEqual([]);
  });
});

describe("i18n usage integrity", () => {
  const APP_DIRS = ["src", "components", "app", "hooks", "lib", "modules"];

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      const st = statSync(p);
      if (st.isDirectory()) out.push(...walk(p));
      else if (/\.(ts|tsx)$/.test(entry) && !/(^|\/)(__tests__|test|tests)\//.test(p)) out.push(p);
    }
    return out;
  }

  /** A key resolves at runtime if the exact key, or its plural forms, exist. */
  const resolves = (k: string) => k in frFlat || k + "_one" in frFlat || k + "_other" in frFlat;

  it("resolves every static t() key used in the codebase", () => {
    const used = new Set<string>();
    for (const dir of APP_DIRS) {
      for (const file of walk(dir)) {
        if (file.includes("node_modules")) continue;
        const src = readFileSync(file, "utf8");
        for (const m of src.matchAll(/\bt\(\s*[`'"]([^`'"]+)[`'"]/g)) {
          const key = m[1];
          if (key.includes("${") || key.endsWith(".")) continue; // dynamic key
          used.add(key.replace(PLURAL_SUFFIX, ""));
        }
        for (const m of src.matchAll(
          /(?:i18nKey|labelKey|descriptionKey|categoryKey)\s*[:=]\s*[`'"]([^`'"]+)[`'"]/g,
        )) {
          const key = m[1];
          if (key.includes("${") || key.endsWith(".")) continue;
          used.add(key.replace(PLURAL_SUFFIX, ""));
        }
      }
    }
    const missing = [...used].filter((k) => !resolves(k)).sort();
    expect(missing).toEqual([]);
  });
});

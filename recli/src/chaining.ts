import type { CaptureRule, RunResult, RunnerContext } from "./types.js";
import { resolveJsonPath, tryParseJson } from "./path-utils.js";

export function applyCaptures(
  captures: CaptureRule[],
  result: RunResult,
  ctx: RunnerContext,
): Record<string, string> {
  const captured: Record<string, string> = {};
  const body = tryParseJson(result.body);

  for (const rule of captures) {
    let value: unknown;

    if (rule.expr.startsWith("body")) {
      const path = rule.expr.slice(4).replace(/^\./, "");
      value = path ? resolveJsonPath(body, path) : body;
    } else if (rule.expr.startsWith("headers")) {
      const headerKey = rule.expr.slice(7).replace(/^\./, "").toLowerCase().replace(/-/g, "");
      for (const [key, val] of Object.entries(result.responseHeaders || {})) {
        if (key.toLowerCase().replace(/-/g, "") === headerKey) {
          value = val;
          break;
        }
      }
    } else if (rule.expr === "status") {
      value = String(result.status);
    } else if (rule.expr === "body") {
      value = JSON.stringify(body);
    }

    if (value !== undefined && value !== null) {
      const strVal = typeof value === "object" ? JSON.stringify(value) : String(value);
      captured[rule.name] = strVal;
      ctx.vars.set(rule.name, strVal);
      ctx.envVars.set(rule.name, strVal);
    }
  }

  return captured;
}

// ── Dynamic variables (Newman/Postman `{{$...}}`) ──────────────────────────
// Generators are evaluated lazily per use. `interpolate` accepts an optional
// per-request cache so the same variable used in URL, headers and body of one
// request resolves to the same value (Newman semantics), while each request
// still gets fresh values. Unknown `$` names fall through to the `{{...}}`
// literal so typos surface in the URL instead of silently.
const WORD_LIST = [
  "alpha",
  "beta",
  "gamma",
  "delta",
  "echo",
  "foxtrot",
  "golf",
  "hotel",
  "india",
  "juliet",
  "kilo",
  "lima",
  "mike",
  "november",
  "oscar",
  "papa",
  "quebec",
  "romeo",
  "sierra",
  "tango",
  "uniform",
  "victor",
  "whiskey",
  "xray",
  "yankee",
  "zulu",
  "dawn",
  "coral",
  "ember",
  "fjord",
  "grove",
];

const FIRST_NAMES = [
  "Ada",
  "Grace",
  "Alan",
  "Linus",
  "Margaret",
  "Dennis",
  "Barbara",
  "Ken",
  "Radia",
  "James",
];
const LAST_NAMES = [
  "Lovelace",
  "Hopper",
  "Turing",
  "Torvalds",
  "Hamilton",
  "Ritchie",
  "Liskov",
  "Thompson",
  "Perlman",
  "Gosling",
];
const CITIES = [
  "Paris",
  "London",
  "Tokyo",
  "Berlin",
  "Kyoto",
  "Oslo",
  "Lima",
  "Cairo",
  "Seoul",
  "Prague",
];
const COUNTRIES = [
  "France",
  "Japan",
  "Germany",
  "Brazil",
  "Egypt",
  "Norway",
  "Italy",
  "Canada",
  "Kenya",
  "Spain",
];
const COUNTRY_CODES = ["FR", "JP", "DE", "BR", "EG", "NO", "IT", "CA", "KE", "ES"];
const COLORS = [
  "red",
  "blue",
  "green",
  "amber",
  "violet",
  "cyan",
  "orange",
  "teal",
  "crimson",
  "indigo",
];
const STREETS = [
  "Maple",
  "Oak",
  "Cedar",
  "Pine",
  "Elm",
  "Birch",
  "Willow",
  "Aspen",
  "Juniper",
  "Laurel",
];
const CURRENCIES = ["EUR", "USD", "JPY", "GBP", "BRL", "CAD", "CHF", "AUD", "SEK", "INR"];
const CURRENCY_NAMES = [
  "Euro",
  "US Dollar",
  "Yen",
  "Pound Sterling",
  "Brazilian Real",
  "Canadian Dollar",
  "Swiss Franc",
  "Australian Dollar",
  "Swedish Krona",
  "Indian Rupee",
];
const CURRENCY_SYMBOLS = ["€", "$", "¥", "£", "R$", "C$", "Fr", "A$", "kr", "₹"];
const WORDS = [
  "lorem",
  "ipsum",
  "dolor",
  "sit",
  "amet",
  "consectetur",
  "adipiscing",
  "elit",
  "sed",
  "do",
  "eiusmod",
  "tempor",
  "incididunt",
  "ut",
  "labore",
  "et",
  "dolore",
  "magna",
  "aliqua",
  "minim",
  "veniam",
  "quis",
  "nostrud",
  "exercitation",
];

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1)) + min;
const randHex = (len: number): string =>
  Array.from({ length: len }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");

/** Subset of Newman's `{{$...}}` dynamic variables — the ones real collections use. */
const DYNAMIC_VARIABLES: Record<string, () => string> = {
  $guid: () =>
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    }),
  $randomUUID: () => DYNAMIC_VARIABLES.$guid(),
  $timestamp: () => String(Math.floor(Date.now() / 1000)),
  $isoTimestamp: () => new Date().toISOString(),
  $randomInt: () => String(randInt(0, 1000)),
  $randomAlphaNumeric: () => randHex(10),
  $randomBoolean: () => (Math.random() >= 0.5 ? "true" : "false"),
  $randomEmail: () => `user${randInt(1, 99999)}@example.com`,
  $randomExampleEmail: () => `user${randInt(1, 99999)}@example.com`,
  $randomUserName: () => `${pick(WORD_LIST)}${randInt(10, 99)}`,
  $randomFirstName: () => pick(FIRST_NAMES),
  $randomLastName: () => pick(LAST_NAMES),
  $randomFullName: () => `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
  $randomPassword: () => `${randHex(6)}${randInt(10, 99)}!`,
  $randomPhoneNumber: () => `+1${Array.from({ length: 10 }, () => randInt(0, 9)).join("")}`,
  $randomCity: () => pick(CITIES),
  $randomCountry: () => pick(COUNTRIES),
  $randomCountryCode: () => pick(COUNTRY_CODES),
  $randomStreet: () => `${randInt(1, 999)} ${pick(STREETS)} St`,
  $randomStreetAddress: () => `${randInt(1, 999)} ${pick(STREETS)} St, ${pick(CITIES)}`,
  $randomZipCode: () => String(randInt(10000, 99999)),
  $randomLatitude: () => (Math.random() * 180 - 90).toFixed(4),
  $randomLongitude: () => (Math.random() * 360 - 180).toFixed(4),
  $randomHexColor: () => `#${randHex(6)}`,
  $randomColor: () => pick(COLORS),
  $randomIP: () => [8, 8, 4, 4].map((n) => randInt(1, n === 8 ? 223 : 255)).join("."),
  $randomIPv6: () => Array.from({ length: 8 }, () => randHex(4)).join(":"),
  $randomWords: () => Array.from({ length: 3 }, () => pick(WORDS)).join(" "),
  $randomSentence: () => {
    const n = randInt(6, 12);
    const words = Array.from({ length: n }, () => pick(WORDS));
    words[0] = words[0][0].toUpperCase() + words[0].slice(1);
    return `${words.join(" ")}.`;
  },
  $randomParagraph: () =>
    Array.from({ length: randInt(3, 6) }, () => {
      const n = randInt(6, 12);
      const words = Array.from({ length: n }, () => pick(WORDS));
      words[0] = words[0][0].toUpperCase() + words[0].slice(1);
      return `${words.join(" ")}.`;
    }).join(" "),
  $randomAbbreviation: () =>
    Array.from({ length: randInt(3, 5) }, () => "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[randInt(0, 25)]).join(
      "",
    ),
  $randomCurrencyCode: () => pick(CURRENCIES),
  $randomCurrencyName: () => pick(CURRENCY_NAMES),
  $randomCurrencySymbol: () => pick(CURRENCY_SYMBOLS),
  $randomCreditCardNumber: () =>
    Array.from({ length: 4 }, () => String(randInt(1000, 9999))).join(" "),
  $randomProduct: () =>
    pick(["Widget", "Gadget", "Doohickey", "Thingamajig", "Contraption", "Doodad"]),
};

/**
 * Resolve `{{var}}` / `{{$dynamic}}` placeholders. `cache` (shared across the
 * URL/headers/body builders of one request) keeps dynamic values stable within
 * a request. Falls back to `process.env` for unknown names (lowest priority).
 */
export function interpolate(
  text: string,
  ctx: RunnerContext,
  cache: Map<string, string> = new Map(),
): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (_match, varName) => {
    const trimmed = varName.trim();
    if (trimmed.startsWith("$")) {
      const gen = DYNAMIC_VARIABLES[trimmed];
      if (gen) {
        let v = cache.get(trimmed);
        if (v === undefined) {
          v = gen();
          cache.set(trimmed, v);
        }
        return v;
      }
      // Unknown $ name: keep the literal so the typo surfaces in the URL.
      ctx.unresolvedVars?.add(trimmed);
      return `{{${trimmed}}}`;
    }
    const value = ctx.vars.get(trimmed);
    if (value !== undefined) return value;
    const envValue = ctx.envVars.get(trimmed);
    if (envValue !== undefined) return envValue;
    const procValue = process.env[trimmed];
    if (procValue !== undefined) return procValue;
    // Unresolved {{var}}: keep the literal (Newman semantics) but record it so
    // the run can warn — a silent 404 with {{VAR}} in the URL is pure friction.
    ctx.unresolvedVars?.add(trimmed);
    return `{{${trimmed}}}`;
  });
}

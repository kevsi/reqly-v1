const FIRST_NAMES = [
    "Alice",
    "Bruno",
    "Chloé",
    "Diego",
    "Emma",
    "Farid",
    "Lucie",
    "Marco",
    "Nina",
    "Oscar",
];
const LAST_NAMES = [
    "Bernard",
    "Cruz",
    "Dupont",
    "Eriksson",
    "Foster",
    "Garcia",
    "Haddad",
    "Ivanov",
    "Jones",
    "Kim",
];
const CITIES = ["Lyon", "Berlin", "Madrid", "Lisbonne", "Prague", "Vienne", "Porto", "Anvers"];
const COUNTRIES = ["France", "Allemagne", "Espagne", "Portugal", "Italie", "Belgique", "Suisse"];
function pick(rng, arr) {
    return arr[Math.floor(rng() * arr.length)];
}
function randInt(rng, min, max) {
    return Math.floor(rng() * (max - min + 1)) + min;
}
function uuid(rng) {
    const hex = () => Math.floor(rng() * 16).toString(16);
    const block = (n) => Array.from({ length: n }, hex).join("");
    return `${block(8)}-${block(4)}-4${block(3)}-${pick(rng, ["8", "9", "a", "b"])}${block(3)}-${block(12)}`;
}
/** Field-name → format inference, checked from the most specific to the least. */
const NAME_HINTS = [
    [/e[-_]?mail/i, "email"],
    [/(uuid|guid)/i, "uuid"],
    [/phone|tel(_|\b)/i, "phone"],
    [/(first[_-]?)?name$|^name$/i, "name"],
    [/first[_-]?name/i, "firstName"],
    [/last[_-]?name|(surname|lastname)/i, "lastName"],
    [/city|town/i, "city"],
    [/country/i, "country"],
    [/(url|link|href|website)$/i, "url"],
    [/(slug|handle)$/i, "slug"],
    [/ip[_-]?(v4|address)?$/i, "ipv4"],
    [/price|amount|cost/i, "price"],
    [/date.*(created|updated|at)$|_at$|At$/i, "date-time"],
    [/(^date$|birth|day\b)/i, "date"],
];
export function inferFormat(fieldName) {
    for (const [re, fmt] of NAME_HINTS)
        if (re.test(fieldName))
            return fmt;
    return undefined;
}
export function generateValue(format, rng) {
    switch (format) {
        case "email":
            return `${pick(rng, ["alice", "bruno", "chloe", "diego", "emma"]).toLowerCase()}.${randInt(rng, 1, 999)}@example.com`;
        case "name":
            return `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`;
        case "firstName":
            return pick(rng, FIRST_NAMES);
        case "lastName":
            return pick(rng, LAST_NAMES);
        case "city":
            return pick(rng, CITIES);
        case "country":
            return pick(rng, COUNTRIES);
        case "phone":
            return `+33 6 ${String(randInt(rng, 10, 99))} ${String(randInt(rng, 10, 99))} ${String(randInt(rng, 10, 99))} ${String(randInt(rng, 10, 99))}`;
        case "url":
            return `https://example.com/${pick(rng, ["api", "docs", "blog", "assets"])}/${randInt(rng, 100, 999)}`;
        case "uuid":
            return uuid(rng);
        case "date": {
            const d = new Date(Date.now() - randInt(rng, 0, 365) * 86_400_000);
            return d.toISOString().slice(0, 10);
        }
        case "date-time":
            return new Date(Date.now() - randInt(rng, 0, 30) * 86_400_000).toISOString();
        case "price":
            return Number((rng() * 500 + 0.99).toFixed(2));
        case "ipv4":
            return `${randInt(rng, 1, 254)}.${randInt(rng, 0, 255)}.${randInt(rng, 0, 255)}.${randInt(rng, 1, 254)}`;
        case "slug":
            return `${pick(rng, ["blue", "fast", "tiny", "bold"])}-${pick(rng, ["otter", "falcon", "tiger", "whale"])}-${randInt(rng, 10, 99)}`;
        default:
            return String(randInt(rng, 1, 10_000));
    }
}
/**
 * Generate a realistic value for a schema node. `keyHint` is the property
 * name currently being generated (used for name-based inference when the
 * schema omits type/format).
 */
export function generate(schema, rng, keyHint) {
    if (!schema || schema.type === "null")
        return null;
    if (schema.enum && schema.enum.length > 0)
        return pick(rng, schema.enum);
    if (schema.example !== undefined)
        return schema.example;
    const type = schema.type ?? "string";
    if (type === "object") {
        const out = {};
        const props = schema.properties ?? {};
        const required = schema.required ?? Object.keys(props);
        for (const [key, child] of Object.entries(props)) {
            // Optional fields appear ~70% of the time to exercise both paths.
            if (!required.includes(key) && rng() > 0.7)
                continue;
            out[key] = generate(child ?? { type: "string" }, rng, key);
        }
        return out;
    }
    if (type === "array") {
        const minItems = schema.minItems ?? (schema.items ? 2 : 1);
        const maxItems = schema.maxItems ?? Math.max(minItems, 4);
        const count = randInt(rng, minItems, maxItems);
        return Array.from({ length: count }, () => generate(schema.items ?? { type: "string" }, rng, keyHint));
    }
    if (type === "boolean")
        return rng() < 0.5;
    if (type === "integer") {
        const min = schema.min ?? 1;
        const max = schema.max ?? 10_000;
        return randInt(rng, Math.ceil(min), Math.floor(max));
    }
    if (type === "number") {
        if (schema.format === "price")
            return generateValue("price", rng);
        const min = schema.min ?? 0;
        const max = schema.max ?? 1000;
        return Number((rng() * (max - min) + min).toFixed(2));
    }
    // Strings: explicit format wins, then name inference, then pattern/length.
    const format = schema.format ?? inferFormat(keyHint ?? "");
    if (schema.pattern)
        return patternToString(schema.pattern, rng);
    if (format)
        return String(generateValue(format, rng));
    const len = schema.max ? randInt(rng, schema.min ?? 1, schema.max) : randInt(rng, 6, 18);
    const slug = String(generateValue("slug", rng));
    return slug.slice(0, Math.max(3, len)).replace(/-/g, "");
}
/** Very small pattern helper: fills \d and a-z classes, literals preserved. */
function patternToString(pattern, rng) {
    let out = "";
    for (let i = 0; i < pattern.length; i++) {
        const ch = pattern[i];
        if (ch === "\\" && pattern[i + 1] === "d") {
            out += String(randInt(rng, 0, 9));
            i++;
        }
        else if (ch === "\\") {
            out += pattern[++i] ?? "";
        }
        else if (/[a-zA-Z]/.test(ch)) {
            out += ch;
        }
        else if (ch === "{") {
            const close = pattern.indexOf("}", i);
            if (close > -1) {
                out += String(randInt(rng, 0, 9)).repeat(Math.min(8, parseInt(pattern.slice(i + 1, close), 10) || 1));
                i = close;
            }
        }
        else if (!"^$+*?.()[]|".includes(ch)) {
            out += ch;
        }
    }
    return out || String(generateValue("slug", rng));
}
//# sourceMappingURL=generator.js.map
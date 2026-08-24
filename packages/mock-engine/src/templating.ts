import type { RequestContext } from "./types.js";
import { generateValue, inferFormat } from "./generator.js";

type Rng = () => number;

const rng: Rng = Math.random;

function readDotPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function resolveToken(token: string, ctx: RequestContext): string | undefined {
  const trimmed = token.trim();

  // {{request.path.id}} / {{request.query.x}} / {{request.header.X-Token}} /
  // {{request.body.user.name}}
  const requestMatch = /^request\.(path|query|header|body)\.(.+)$/i.exec(trimmed);
  if (requestMatch) {
    const scope = requestMatch[1] as string;
    const rest = requestMatch[2] as string;
    switch (scope.toLowerCase()) {
      case "path":
        return ctx.path[rest] !== undefined ? String(ctx.path[rest]) : "";
      case "query":
        return ctx.query[rest] !== undefined ? String(ctx.query[rest]) : "";
      case "header":
        return String(ctx.headers[rest.toLowerCase()] ?? "");
      case "body": {
        const v = readDotPath(ctx.body, rest);
        return v === undefined ? "" : valueToComparable(v);
      }
    }
  }

  const lower = trimmed.toLowerCase();
  if (lower === "uuid" || lower === "guid") return String(generateValue("uuid", rng));
  if (lower === "nowiso" || lower === "now.iso") return new Date().toISOString();
  if (lower === "nowunix") return String(Math.floor(Date.now() / 1000));
  if (lower === "nowms") return String(Date.now());

  // {{int 1 10}} / {{float 0 100 2}}
  const intMatch = /^int\s+(-?\d+)\s+(-?\d+)$/i.exec(trimmed);
  if (intMatch) {
    const min = parseInt(intMatch[1] as string, 10);
    const max = parseInt(intMatch[2] as string, 10);
    return String(Math.floor(rng() * (max - min + 1)) + min);
  }
  const floatMatch = /^float\s+(-?[\d.]+)\s+(-?[\d.]+)(?:\s+(\d+))?$/i.exec(trimmed);
  if (floatMatch) {
    const min = parseFloat(floatMatch[1] as string);
    const max = parseFloat(floatMatch[2] as string);
    const dec = parseInt((floatMatch[3] as string) ?? "2", 10);
    return (rng() * (max - min) + min).toFixed(dec);
  }

  // {{faker.email}} / {{faker.city}} … (any generator format)
  const fakerMatch = /^faker\.(\w+)$/i.exec(trimmed);
  if (fakerMatch) {
    const fmt = (fakerMatch[1] as string).toLowerCase();
    const known = [
      "email",
      "name",
      "firstname",
      "lastname",
      "city",
      "country",
      "phone",
      "url",
      "uuid",
      "date",
      "date-time",
      "price",
      "ipv4",
      "slug",
    ];
    const canonical = known.find((k) => k.toLowerCase() === fmt.replace(/_/g, "-"));
    if (canonical) return String(generateValue(canonical as never, rng));
    const inferred = inferFormat(fmt);
    if (inferred) return String(generateValue(inferred, rng));
  }

  return undefined;
}

function valueToComparable(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/**
 * Resolve {{...}} tokens in a static body against the current request.
 * Unknown tokens are left untouched so users can keep literal braces.
 */
export function resolveTemplate(template: string, ctx: RequestContext): string {
  return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (raw, token: string) => {
    const resolved = resolveToken(token, ctx);
    return resolved === undefined ? raw : resolved;
  });
}

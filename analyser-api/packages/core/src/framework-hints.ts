export interface FrameworkHint {
  name: string;
  patterns: RegExp[];
}

/** HTTP server frameworks commonly found in backends but not supported by any
 * detector. When such usage is detected and no routes (or only unknown-
 * framework routes) are extracted, the analyzer emits a warning so missing
 * routes are visible instead of silently reported as absent. */
export const SERVER_FRAMEWORK_HINTS: FrameworkHint[] = [
  {
    name: "hono",
    patterns: [
      /\bfrom\s+["']hono["']/,
      /\brequire\s*\(\s*["']hono["']\s*\)/,
      /\bnew\s+Hono\s*\(/,
    ],
  },
  {
    name: "koa",
    patterns: [
      /\bfrom\s+["']koa["']/,
      /\brequire\s*\(\s*["']koa["']\s*\)/,
      /\bnew\s+Koa\s*\(/,
    ],
  },
  {
    name: "hapi",
    patterns: [/\bfrom\s+["']@hapi\/hapi["']/, /\brequire\s*\(\s*["']@hapi\/hapi["']\s*\)/],
  },
  {
    name: "restify",
    patterns: [
      /\bfrom\s+["']restify["']/,
      /\brequire\s*\(\s*["']restify["']\s*\)/,
      /\brestify\.createServer\s*\(/,
    ],
  },
  {
    name: "sails",
    patterns: [/\brequire\s*\(\s*["']sails["']\s*\)/, /\bfrom\s+["']sails["']/],
  },
  {
    name: "fiber",
    patterns: [/\bgithub\.com\/gofiber\/fiber\b/],
  },
  {
    name: "chi",
    patterns: [/\bgithub\.com\/go-chi\/chi\b/],
  },
  {
    name: "gorilla/mux",
    patterns: [/\bgithub\.com\/gorilla\/mux\b/],
  },
  {
    name: "sanic",
    patterns: [/\bfrom\s+sanic\b/, /\bimport\s+sanic\b/],
  },
  {
    name: "tornado",
    patterns: [/\bimport\s+tornado\b/, /\bfrom\s+tornado\b/],
  },
  {
    name: "aiohttp",
    patterns: [/\bfrom\s+aiohttp\b/, /\bimport\s+aiohttp\b/],
  },
  {
    name: "bottle",
    patterns: [/\bfrom\s+bottle\s+import\b/, /\bimport\s+bottle\b/],
  },
  {
    name: "warp",
    patterns: [/\bwarp::/],
  },
  {
    name: "rocket",
    patterns: [/\brocket::/],
  },
  {
    name: "salvo",
    patterns: [/\bsalvo::/],
  },
];

/** Returns the names of unsupported server frameworks whose signature appears
 * in a source file. */
export function detectFrameworkHints(src: string): string[] {
  return SERVER_FRAMEWORK_HINTS.filter((h) => h.patterns.some((p) => p.test(src))).map(
    (h) => h.name,
  );
}

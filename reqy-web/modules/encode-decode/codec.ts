export type CodecMode =
  | "b64-encode"
  | "b64-decode"
  | "url-encode"
  | "url-decode"
  | "hex-encode"
  | "hex-decode"
  | "json-format"
  | "json-minify"
  | "json-to-csv"
  | "csv-to-json"
  | "html-encode"
  | "html-decode"
  | "regex-escape"
  | "sql-escape";

export const CODEC_MODES: { id: CodecMode; label: string }[] = [
  { id: "b64-encode", label: "Base64 — encoder" },
  { id: "b64-decode", label: "Base64 — décoder" },
  { id: "url-encode", label: "URL — encoder" },
  { id: "url-decode", label: "URL — décoder" },
  { id: "hex-encode", label: "Hex — encoder" },
  { id: "hex-decode", label: "Hex — décoder" },
  { id: "json-format", label: "JSON — formater" },
  { id: "json-minify", label: "JSON — minifier" },
  { id: "json-to-csv", label: "JSON — vers CSV" },
  { id: "csv-to-json", label: "CSV — vers JSON" },
  { id: "html-encode", label: "HTML — encoder" },
  { id: "html-decode", label: "HTML — décoder" },
  { id: "regex-escape", label: "Regex — échapper" },
  { id: "sql-escape", label: "SQL — échapper" },
];

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function b64ToBytes(input: string): Uint8Array {
  const bin = atob(input.replace(/\s+/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function hexToBytes(input: string): Uint8Array {
  const hex = input.replace(/\s+/g, "");
  if (hex.length % 2 !== 0) throw new Error("Longueur hex impaire");
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export { bytesToHex };

const ENCODE_MODES: CodecMode[] = [
  "b64-encode",
  "url-encode",
  "hex-encode",
  "html-encode",
  "regex-escape",
  "sql-escape",
];

/** Encode a string to UTF-8 bytes, then apply the mode. */
export function encode(mode: CodecMode, input: string): string {
  switch (mode) {
    case "b64-encode":
      return bytesToB64(new TextEncoder().encode(input));
    case "url-encode":
      return encodeURIComponent(input);
    case "hex-encode":
      return bytesToHex(new TextEncoder().encode(input));
    case "html-encode":
      return htmlEncode(input);
    case "regex-escape":
      return regexEscape(input);
    case "sql-escape":
      return sqlEscape(input);
    default:
      throw new Error("Mode non-encodable");
  }
}

/** Decode/transform input back to a string. */
export function decode(mode: CodecMode, input: string): string {
  switch (mode) {
    case "b64-decode":
      return new TextDecoder().decode(b64ToBytes(input));
    case "url-decode":
      return decodeURIComponent(input);
    case "hex-decode":
      return new TextDecoder().decode(hexToBytes(input));
    case "json-format":
      return JSON.stringify(JSON.parse(input), null, 2);
    case "json-minify":
      return JSON.stringify(JSON.parse(input));
    case "json-to-csv":
      return jsonToCsv(input);
    case "csv-to-json":
      return csvToJson(input);
    case "html-decode":
      return htmlDecode(input);
    default:
      throw new Error("Mode non-décodable");
  }
}

/** Apply the mode; returns { ok } or a human-readable error. */
export function transform(mode: CodecMode, input: string): { ok: true; output: string } | { ok: false; error: string } {
  try {
    const fn = ENCODE_MODES.includes(mode) ? encode : decode;
    return { ok: true, output: fn(mode, input) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── escapes ──────────────────────────────────────────────────────────────

/** Escape HTML special chars (& < > " '). */
export function htmlEncode(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Decode the entities produced by htmlEncode. */
export function htmlDecode(input: string): string {
  return input
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

/** Escape a literal string so it matches itself inside a RegExp. */
export function regexEscape(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Escape a string literal for use inside single-quoted SQL. */
export function sqlEscape(input: string): string {
  return input.replace(/'/g, "''");
}

// ── CSV ──────────────────────────────────────────────────────────────────

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Convert a JSON array of flat objects to CSV (header row + rows). */
export function jsonToCsv(input: string): string {
  const data = JSON.parse(input) as unknown;
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("Attendu un tableau JSON non vide (ex: [{\"id\":1,\"nom\":\"A\"}])");
  }
  const rows: unknown[] = data;
  const keys = Array.from(new Set(rows.flatMap((r) => Object.keys(r as Record<string, unknown>))));
  const lines = [keys.join(",")];
  for (const row of rows) {
    lines.push(
      keys
        .map((k) => csvCell(String((row as Record<string, unknown>)[k] ?? "")))
        .join(","),
    );
  }
  return lines.join("\n");
}

/** Convert CSV (comma, optional quoted cells) to a JSON array of objects. */
export function csvToJson(input: string): string {
  const rows = parseCsv(input);
  if (rows.length === 0) throw new Error("CSV vide.");
  const headers = rows[0].map((h) => h.trim());
  const objects = rows.slice(1).map((cells) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = cells[i] ?? "";
    });
    return obj;
  });
  return JSON.stringify(objects, null, 2);
}

/** Minimal CSV parser: comma-separated, double-quoted cells with "" escapes. */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch === "\r") {
      // skip; handled by the \n case
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.length > 1 || row[0] !== "") rows.push(row);
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

// ── auto-detection ───────────────────────────────────────────────────────

export type DetectedKind = "jwt" | "json" | "base64" | "url" | "hex" | "plain";

export interface DetectResult {
  kind: DetectedKind;
  mode: CodecMode | null;
}

function looksLikeBase64(input: string): boolean {
  const clean = input.trim();
  if (clean.length % 4 !== 0) return false;
  if (!/^[A-Za-z0-9+/=\s]+$/.test(clean)) return false;
  try {
    b64ToBytes(clean);
    return true;
  } catch {
    return false;
  }
}

/**
 * Guess what a pasted value is. Returns the most specific kind plus the
 * transformer mode that would make sense for it (null for jwt/plain).
 */
export function detect(input: string): DetectResult {
  const t = input.trim();
  if (!t) return { kind: "plain", mode: null };

  // JWT: three dot-separated segments, header decodes as JSON.
  const parts = t.split(".");
  if (parts.length === 3 && decodeJwt(t).ok) {
    return { kind: "jwt", mode: null };
  }

  // JSON object/array.
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      JSON.parse(t);
      return { kind: "json", mode: "json-format" };
    } catch {
      /* not json */
    }
  }

  // URL-encoded.
  if (/^[A-Za-z0-9%._~:/?#[\]@!$&'()*+,;= -]+$/.test(t) && t.includes("%")) {
    return { kind: "url", mode: "url-decode" };
  }

  // Hex: even-length, all hex chars.
  if (/^[0-9a-fA-F]+$/.test(t) && t.length % 2 === 0 && t.length >= 2) {
    return { kind: "hex", mode: "hex-decode" };
  }

  // Base64 decodes to printable text.
  if (looksLikeBase64(t)) {
    try {
      const dec = new TextDecoder().decode(b64ToBytes(t));
      if (/^[\x20-\x7e\n\r\t]*$/.test(dec) && dec.trim().length > 0) {
        return { kind: "base64", mode: "b64-decode" };
      }
    } catch {
      /* fallthrough */
    }
  }

  return { kind: "plain", mode: null };
}

// ── helpers ──────────────────────────────────────────────────────────────

export function utf8ByteLength(input: string): number {
  return new TextEncoder().encode(input).byteLength;
}

// ── hashing (WebCrypto) ──────────────────────────────────────────────────

export type HashAlgorithm = "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512";

export async function hashText(algo: HashAlgorithm, input: string): Promise<string> {
  const buf = await crypto.subtle.digest(algo, new TextEncoder().encode(input));
  return bytesToHex(new Uint8Array(buf));
}

export const HASH_ALGOS: { id: HashAlgorithm; label: string }[] = [
  { id: "SHA-256", label: "SHA-256" },
  { id: "SHA-512", label: "SHA-512" },
  { id: "SHA-384", label: "SHA-384" },
  { id: "SHA-1", label: "SHA-1" },
];

// ── JWT decode ───────────────────────────────────────────────────────────

export interface DecodedJwt {
  ok: boolean;
  error?: string;
  header?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  signatureHex?: string;
  /** Seconds since epoch (payload.exp) if present. */
  exp?: number;
}

function b64urlToJson(segment: string): Record<string, unknown> | null {
  try {
    const pad = segment.length % 4 === 0 ? "" : "=".repeat(4 - (segment.length % 4));
    const bin = atob(segment.replace(/-/g, "+").replace(/_/g, "/") + pad);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function b64urlToBytes(segment: string): Uint8Array {
  const pad = segment.length % 4 === 0 ? "" : "=".repeat(4 - (segment.length % 4));
  const bin = atob(segment.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Decode a JWT's header + payload WITHOUT verifying the signature. */
export function decodeJwt(token: string): DecodedJwt {
  const parts = token.trim().split(".");
  if (parts.length !== 3) {
    return { ok: false, error: "Un JWT doit avoir 3 segments (header.payload.signature)." };
  }
  const header = b64urlToJson(parts[0]);
  const payload = b64urlToJson(parts[1]);
  if (!header || !payload) {
    return { ok: false, error: "Impossible de décoder header/payload : ce n'est pas un JWT valide." };
  }
  const exp = typeof payload.exp === "number" ? payload.exp : undefined;
  return {
    ok: true,
    header,
    payload,
    signatureHex: bytesToHex(new TextEncoder().encode(parts[2])),
    exp,
  };
}

export interface JwtVerifyResult {
  valid: boolean;
  error?: string;
  alg?: string;
}

const JWT_ALG_TO_SHA: Record<string, HashAlgorithm> = {
  HS256: "SHA-256",
  HS384: "SHA-384",
  HS512: "SHA-512",
};

/**
 * Verify a JWT's HMAC signature with a secret (WebCrypto).
 * Only HS256/384/512 are supported; returns valid=false otherwise.
 */
export async function verifyJwt(token: string, secret: string): Promise<JwtVerifyResult> {
  const parts = token.trim().split(".");
  if (parts.length !== 3) {
    return { valid: false, error: "Un JWT doit avoir 3 segments (header.payload.signature)." };
  }
  const header = b64urlToJson(parts[0]);
  const alg = typeof header?.alg === "string" ? header.alg : "";
  const sha = JWT_ALG_TO_SHA[alg];
  if (!sha) {
    return {
      valid: false,
      error: alg ? `Algorithme ${alg} non supporté (HMAC HS256/384/512 uniquement).` : "Algorithme absent du header.",
    };
  }
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: sha },
      false,
      ["sign"],
    );
    const signature = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${parts[0]}.${parts[1]}`)),
    );
    const expected = bytesToHex(signature);
    const actual = bytesToHex(b64urlToBytes(parts[2]));
    const ok = expected.length === actual.length && expected === actual;
    return { valid: ok, alg };
  } catch (e) {
    return { valid: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── generators ───────────────────────────────────────────────────────────

export function uuidv4(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  return bytesToHex(b).replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");
}

export function randomHexBytes(n: number): string {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return bytesToHex(b);
}

export function randomBase64(n = 16): string {
  const b = crypto.getRandomValues(new Uint8Array(n));
  let bin = "";
  for (const byte of b) bin += String.fromCharCode(byte);
  return btoa(bin);
}


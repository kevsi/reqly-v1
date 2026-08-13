export interface ParsedCodeRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

function tokenizeShell(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (const char of input) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
    } else if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (escaped) current += "\\";
  if (current) tokens.push(current);
  return tokens;
}

function parseHeader(value: string): [string, string] | null {
  const separator = value.indexOf(":");
  if (separator <= 0) return null;
  const name = value.slice(0, separator).trim();
  const headerValue = value.slice(separator + 1).trim();
  return name ? [name, headerValue] : null;
}

/** Parse uniquement les snippets cURL HTTP(S) ; les autres langages restent du code copiable. */
export function parseCurlRequest(source: string): ParsedCodeRequest | null {
  const normalized = source
    .replace(/\\\r?\n\s*/g, " ")
    .replace(/\r?\n\s*/g, " ")
    .trim();
  if (!/^curl(?:\s|$)/i.test(normalized)) return null;

  const tokens = tokenizeShell(normalized);
  if (tokens[0]?.toLowerCase() !== "curl") return null;

  let method = "GET";
  let url = "";
  let body: string | undefined;
  const headers: Record<string, string> = {};
  const methodFlags = new Set(["-X", "--request"]);
  const headerFlags = new Set(["-H", "--header"]);
  const bodyFlags = new Set(["-d", "--data", "--data-raw", "--data-binary", "--data-urlencode"]);
  const ignoredFlags = new Set([
    "-s",
    "--silent",
    "-S",
    "--show-error",
    "-L",
    "--location",
    "--compressed",
    "-k",
    "--insecure",
  ]);

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (methodFlags.has(token)) {
      method = tokens[++index]?.toUpperCase() ?? method;
      continue;
    }
    if (headerFlags.has(token)) {
      const header = parseHeader(tokens[++index] ?? "");
      if (header) headers[header[0]] = header[1];
      continue;
    }
    if (bodyFlags.has(token)) {
      body = tokens[++index] ?? "";
      if (method === "GET") method = "POST";
      continue;
    }
    if (ignoredFlags.has(token)) continue;
    if (token.startsWith("-")) continue;
    if (!url && /^https?:\/\//i.test(token)) url = token;
  }

  if (!url || !/^https?:\/\//i.test(url) || !method) return null;
  return { method, url, headers, ...(body !== undefined ? { body } : {}) };
}

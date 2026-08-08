/**
 * Parser curl unifié entre reqy-web et reqy-mcp.
 * Supporte : -X, --request, -H, --header, -d, --data, --data-raw, -u
 * Génération : generateCurlCommand pour exporter une requête en curl
 */

export interface ParsedCurl {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  auth?: { type: "basic"; username: string; password: string };
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const len = input.length;

  while (i < len) {
    while (i < len && /\s/.test(input[i])) i++;
    if (i >= len) break;

    const ch = input[i];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      let value = "";
      while (i < len && input[i] !== quote) {
        if (input[i] === "\\" && i + 1 < len) {
          value += input[i + 1];
          i += 2;
        } else {
          value += input[i];
          i++;
        }
      }
      i++;
      tokens.push(value);
    } else {
      let value = "";
      while (i < len && !/\s/.test(input[i])) {
        value += input[i];
        i++;
      }
      tokens.push(value);
    }
  }

  return tokens;
}

function extractAfterEquals(token: string): string | undefined {
  const idx = token.indexOf("=");
  if (idx === -1) return undefined;
  return token.slice(idx + 1);
}

export function parseCurlCommand(command: string): ParsedCurl | null {
  try {
    let cmd = command.trim();
    cmd = cmd.replace(/^curl\s+/i, "").trim();
    if (cmd.startsWith("curl")) cmd = cmd.slice(4).trim();

    const tokens = tokenize(cmd);

    let method = "GET";
    const headers: Record<string, string> = {};
    let body: string | undefined;
    let auth: ParsedCurl["auth"] | undefined;
    let url = "";
    let skipNext = false;

    for (let i = 0; i < tokens.length; i++) {
      if (skipNext) {
        skipNext = false;
        continue;
      }

      const tok = tokens[i];

      if (tok === "-X" || tok === "--request") {
        const val = extractAfterEquals(tok) ?? tokens[i + 1];
        if (val) {
          method = val.toUpperCase();
          skipNext = true;
        }
        continue;
      }

      if (tok === "-H" || tok === "--header") {
        const val = extractAfterEquals(tok) ?? tokens[i + 1];
        if (val) {
          const colonIdx = val.indexOf(":");
          if (colonIdx !== -1) {
            const key = val.slice(0, colonIdx).trim();
            const value = val.slice(colonIdx + 1).trim();
            headers[key] = value;
          } else {
            headers[val] = "";
          }
        }
        skipNext = true;
        continue;
      }

      if (
        tok === "-d" ||
        tok === "--data" ||
        tok === "--data-raw" ||
        tok.startsWith("--data=") ||
        tok.startsWith("-d")
      ) {
        const val =
          tok.startsWith("-d") && tok.length > 2
            ? tok.slice(2)
            : tok.startsWith("--data=")
              ? tok.slice("--data=".length)
              : (extractAfterEquals(tok) ?? tokens[i + 1]);
        if (val !== undefined) body = val;
        if (tok === "-d" || tok === "--data" || tok === "--data-raw") skipNext = true;
        continue;
      }

      if (tok === "-u" || tok.startsWith("-u")) {
        const val = tok.startsWith("-u") && tok.length > 2 ? tok.slice(2) : tokens[i + 1];
        if (val) {
          const colonIdx = val.indexOf(":");
          auth = {
            type: "basic",
            username: val.slice(0, colonIdx),
            password: colonIdx !== -1 ? val.slice(colonIdx + 1) : "",
          };
        }
        if (tok === "-u") skipNext = true;
        continue;
      }

      if (/^https?:\/\//i.test(tok) && !tok.startsWith("-")) {
        url = tok;
        continue;
      }
    }

    // Real curl defaults to POST when a body is sent without an explicit -X.
    if (body && method === "GET") method = "POST";

    if (!url) return null;

    return { method, url, headers, body, auth };
  } catch {
    return null;
  }
}

export function generateCurlCommand(request: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  authType?: string;
  authToken?: string;
}): string {
  const parts = ["curl"];

  if (request.method && request.method !== "GET") {
    parts.push("-X", request.method);
  }

  if (request.headers) {
    for (const [key, value] of Object.entries(request.headers)) {
      if (request.authType === "basic" && key.toLowerCase() === "authorization") continue;
      parts.push("-H", `${key}: ${value}`);
    }
  }

  if (request.authType === "basic" && request.authToken) {
    parts.push("-u", request.authToken);
  } else if (request.authType === "bearer" && request.authToken) {
    parts.push("-H", `Authorization: Bearer ${request.authToken}`);
  } else if (request.authType === "api-key" && request.authToken) {
    parts.push("-H", `x-api-key: ${request.authToken}`);
  }

  if (request.body) {
    parts.push("-d", request.body);
  }

  parts.push(request.url);

  return parts.join(" ");
}

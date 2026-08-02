import { REQLY_TOOLS } from "@/lib/llm-tools";

// Some providers/models don't emit real function-calling (delta.tool_calls)
// and instead write the tool invocation as plain text, then hallucinate a
// success message. This parser detects those textual invocations so the
// agent can execute them for real.

export interface TextToolCall {
  id: string;
  name: string;
  /** Arguments as a JSON string (parseable object). */
  arguments: string;
  /** Index where the call starts in the source text. */
  start: number;
  /** Index just after the call text. */
  end: number;
}

const TOOL_NAMES = new Set(REQLY_TOOLS.map((t) => t.name));
// Longest-first so regexes don't match a prefix of a longer tool name.
const TOOL_NAMES_SORTED = [...TOOL_NAMES].sort((a, b) => b.length - a.length);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Parse simple XML children `<key>value</key>` into an object. */
function xmlElementsToJson(inner: string): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  const re = /<([A-Za-z0-9_]+)>([\s\S]*?)<\/\1>/g;
  let m: RegExpExecArray | null;
  let found = false;
  while ((m = re.exec(inner))) {
    found = true;
    const raw = m[2].trim();
    out[m[1]] = parseXmlValue(raw);
  }
  if (!found) {
    const trimmed = inner.trim();
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        /* ignore */
      }
    }
  }
  return found ? out : null;
}

function parseXmlValue(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if ((raw.startsWith("{") && raw.endsWith("}")) || (raw.startsWith("[") && raw.endsWith("]"))) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      /* keep as string */
    }
  }
  return raw;
}

let textCallCounter = 0;

function pushCall(
  out: TextToolCall[],
  name: string,
  argsObj: Record<string, unknown>,
  start: number,
  end: number,
): void {
  textCallCounter++;
  out.push({
    id: `text_${name}_${textCallCounter}_${Date.now().toString(36)}`,
    name,
    arguments: JSON.stringify(argsObj),
    start,
    end,
  });
}

/**
 * Extrait les invocations d'outils écrites en texte par le modèle.
 *
 * Formats supportés :
 *  - XML : `<create_collection>\n<name>Test</name>\n</create_collection>`
 *  - JSON entre parenthèses : `create_collection({"name": "Test"})`
 *
 * Retourne les appels triés par position d'apparition, ou `[]` si aucun.
 */
export function extractTextToolCalls(text: string): TextToolCall[] {
  if (!text) return [];
  const out: TextToolCall[] = [];

  for (const name of TOOL_NAMES_SORTED) {
    const escaped = escapeRegExp(name);

    // XML-style: <name>...</name>
    const xmlRe = new RegExp(`<${escaped}>([\\s\\S]*?)<\\/${escaped}>`, "gi");
    let m: RegExpExecArray | null;
    while ((m = xmlRe.exec(text))) {
      const argsObj = xmlElementsToJson(m[1]);
      if (argsObj) {
        pushCall(out, name, argsObj, m.index, m.index + m[0].length);
      }
    }

    // Function-style: name({...json...})
    const fnRe = new RegExp(`${escaped}\\s*\\(\\s*(\\{[\\s\\S]*?\\})\\s*\\)`, "gi");
    while ((m = fnRe.exec(text))) {
      try {
        const parsed = JSON.parse(m[1]);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          pushCall(out, name, parsed, m.index, m.index + m[0].length);
        }
      } catch {
        /* ignore malformed JSON args */
      }
    }
  }

  out.sort((a, b) => a.start - b.start);
  return out;
}

/** Supprime les plages d'appels du texte (sans toucher au reste). */
export function stripToolCallText(text: string, calls: TextToolCall[]): string {
  if (calls.length === 0) return text;
  let out = "";
  let cursor = 0;
  for (const c of calls) {
    out += text.slice(cursor, c.start);
    cursor = c.end;
  }
  out += text.slice(cursor);
  return out.trim();
}

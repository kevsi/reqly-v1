/**
 * Helpers purs du client WebSocket — testables sans Tauri ni DOM.
 */

export type WsDirection = "in" | "out";

export interface WsTimelineEntry {
  id: string;
  direction: WsDirection;
  /** text | binary | ping */
  kind: string;
  data: string;
  byteLen: number;
  timestamp: number;
}

/** Cap mémoire de la timeline ; les plus anciennes entrées sont décalées. */
export const WS_TIMELINE_CAP = 500;

export function pushTimelineEntry(
  entries: WsTimelineEntry[],
  entry: WsTimelineEntry,
  cap = WS_TIMELINE_CAP,
): WsTimelineEntry[] {
  const next = entries.length >= cap ? entries.slice(-(cap - 1)) : entries.slice();
  next.push(entry);
  return next;
}

export function makeEntryId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Aperçu hexadécimal borné d'un payload binaire (reçu en base64). */
export function base64ToHexPreview(base64: string, maxBytes = 64): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = base64.replace(/=+$/, "");
  const bytes: number[] = [];  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < clean.length && bytes.length < maxBytes; i += 1) {
    const value = chars.indexOf(clean[i]);
    if (value === -1) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join(" ");
}

export function isValidJson(raw: string): boolean {
  if (!raw.trim()) return false;
  try {
    JSON.parse(raw);
    return true;
  } catch {
    return false;
  }
}

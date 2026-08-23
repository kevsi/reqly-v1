/**
 * Helpers purs partagés par la page Capture (et potentiellement d'autres
 * écrans) : formatage temps, extraction d'hôte, pretty-print JSON.
 * Extrait du god-file `app/(app)/capture/page.tsx` — comportement identique.
 */

export function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return "";
  }
}

export function extractHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function prettyJson(raw: string | null | undefined): string {
  if (!raw) return "";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/** Convertit une liste de paires [clé, valeur] en Record. */
export function headersToRecord(headers?: Array<[string, string]> | null): Record<string, string> {
  const record: Record<string, string> = {};
  if (!headers) return record;
  for (const [k, v] of headers) {
    if (k) record[k] = v;
  }
  return record;
}

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { EnvironmentVariable } from "@/lib/types";
import type { TauriCookie } from "@/lib/tauri";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Clés d'objet dangereuses (prototype pollution). */
export const UNSAFE_OBJECT_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

/** `true` si une clé pourrait polluer le prototype (input non fiable). */
export function isUnsafeObjectKey(key: string): boolean {
  return UNSAFE_OBJECT_KEYS.has(key);
}

/** Generate a UUID v4 (uses crypto.randomUUID when available). */
export function uuidV4(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function interpolate(text: string, variables: EnvironmentVariable[]): string {
  if (!text) return text;
  let result = text;
  const enabledVars = variables.filter((v) => v.enabled && v.key.trim() !== "");

  // Replace each {{KEY}} with the variable value. CR/LF are stripped from
  // values so an environment variable cannot smuggle extra HTTP headers
  // (CRLF injection) into requests built from templates.
  enabledVars.forEach((v) => {
    const escapedKey = escapeRegex(v.key.trim());
    const regex = new RegExp(`\\{\\{\\s*${escapedKey}\\s*\\}\\}`, "g");
    result = result.replace(regex, v.value.replace(/[\r\n]/g, " "));
  });

  return result;
}

export function hasUnresolvedPlaceholders(text: string): boolean {
  return /\{\{\s*[^}]+\s*\}\}/.test(text);
}

/** Forme typée de la réponse JSON renvoyée par le proxy. */
export interface ProxySafeResult {
  body?: unknown;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  cookies?: TauriCookie[];
  timings?: { dnsMs?: number; connectMs?: number; ttfbMs?: number };
  durationMs?: number;
  encoding?: string;
  error?: string;
  /** Code machine de l'erreur (ex. RATE_LIMIT_EXCEEDED, BLOCKED_SSRF, TIMEOUT). */
  code?: string;
}

export async function parseJsonSafe(response: Response): Promise<ProxySafeResult> {
  const text = await response.text().catch(() => "");
  try {
    return JSON.parse(text) as ProxySafeResult;
  } catch {
    return {
      error: text || `Invalid JSON response from ${response.url || "proxy"}`,
      status: response.status,
      statusText: response.statusText,
    };
  }
}

export function replaceLocalhostPort(url: string, port: number): string {
  if (!url) return url;
  return url.replace(/\/\/localhost:\d+/, `//localhost:${port}`);
}

export async function downloadJson(data: unknown, filename: string) {
  const content = JSON.stringify(data, null, 2);
  // Tauri v1 expose `__TAURI__`, Tauri v2 expose `__TAURI_INTERNALS__`.
  const isTauri =
    typeof window !== "undefined" && ("__TAURI__" in window || "__TAURI_INTERNALS__" in window);

  if (isTauri) {
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const { writeTextFile } = await import("@tauri-apps/plugin-fs");

      const filePath = await save({
        defaultPath: filename,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });

      if (filePath) {
        await writeTextFile(filePath, content);
      }
      return;
    } catch (err) {
      console.error("Failed to save file using Tauri dialog", err);
      // fallback to browser approach if it fails
    }
  }

  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

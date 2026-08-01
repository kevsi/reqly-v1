import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { EnvironmentVariable } from "@/lib/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function interpolate(text: string, variables: EnvironmentVariable[]): string {
  if (!text) return text;
  let result = text;
  const enabledVars = variables.filter((v) => v.enabled && v.key.trim() !== "");

  // Replace each {{KEY}} with the variable value
  enabledVars.forEach((v) => {
    const escapedKey = escapeRegex(v.key.trim());
    const regex = new RegExp(`\\{\\{\\s*${escapedKey}\\s*\\}\\}`, "g");
    result = result.replace(regex, v.value);
  });

  return result;
}

export function hasUnresolvedPlaceholders(text: string): boolean {
  return /\{\{\s*[^}]+\s*\}\}/.test(text);
}

export async function parseJsonSafe(response: Response): Promise<any> {
  const text = await response.text().catch(() => "");
  try {
    return JSON.parse(text);
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

export async function downloadJson(data: any, filename: string) {
  const content = JSON.stringify(data, null, 2);
  const isTauri = typeof window !== "undefined" && "__TAURI__" in window;

  if (isTauri) {
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const { writeTextFile } = await import("@tauri-apps/plugin-fs");

      const filePath = await save({
        defaultPath: filename.endsWith(".json") ? filename : `${filename}.json`,
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
  a.download = filename.endsWith(".json") ? filename : `${filename}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

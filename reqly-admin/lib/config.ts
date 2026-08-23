"use client";

/** Configuration admin stockée en localStorage (surface opérateur). */

export interface AdminConfig {
  syncBase: string; // ex. https://reqly.duckdns.org
  syncToken: string; // ADMIN_TOKEN du sync-server
  monitorBase: string; // ex. https://reqly.duckdns.org/monitor
  monitorToken: string; // ADMIN_TOKEN de reqly-monitor
}

const KEY = "reqly_admin_config";

export const emptyConfig: AdminConfig = {
  syncBase: "",
  syncToken: "",
  monitorBase: "",
  monitorToken: "",
};

export function loadConfig(): AdminConfig {
  if (typeof window === "undefined") return emptyConfig;
  try {
    return { ...emptyConfig, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return emptyConfig;
  }
}

export function saveConfig(cfg: AdminConfig): void {
  localStorage.setItem(KEY, JSON.stringify(cfg));
}

export function clearConfig(): void {
  localStorage.removeItem(KEY);
}

export function isSyncReady(cfg: AdminConfig): boolean {
  return Boolean(cfg.syncBase.trim() && cfg.syncToken.trim());
}

export function isMonitorReady(cfg: AdminConfig): boolean {
  return Boolean(cfg.monitorBase.trim() && cfg.monitorToken.trim());
}

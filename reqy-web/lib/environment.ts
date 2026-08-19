/**
 * Environment detection utilities
 * Distinguishes between web deployment and desktop Tauri app
 */

/**
 * Check if running in Tauri desktop environment
 */
export function isDesktopApp(): boolean {
  // Tauri stores metadata in window.__TAURI_METADATA__
  if (typeof window === "undefined") {
    return false;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return !!(window as any).__TAURI_METADATA__;
}

/**
 * Check if this is a public web deployment
 * Based on NEXT_PUBLIC_DEPLOYMENT_TYPE environment variable
 */
export function isPublicWebDeployment(): boolean {
  return typeof process !== "undefined" && process.env.NEXT_PUBLIC_DEPLOYMENT_TYPE === "web";
}

/**
 * Get deployment type
 */
export function getDeploymentType(): "web" | "desktop" {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_DEPLOYMENT_TYPE === "desktop") {
    return "desktop";
  }
  return "web";
}

/**
 * Check if origin is from Tauri app
 * Tauri sends requests from localhost or with specific origin header
 */
export function isTauriOrigin(originHeader?: string | null): boolean {
  if (!originHeader) {
    return false;
  }

  const origin = originHeader.toLowerCase();
  return (
    origin.includes("localhost") ||
    origin.includes("127.0.0.1") ||
    origin.includes("tauri://") ||
    origin === "ipc://localhost"
  );
}

"use client"

import { persistence } from "./persistence"
import { isTauriAvailable } from "./tauri"
import { moduleLevelCommit } from "@/hooks/use-request-store"
import type { Notification } from "./types"

/**
 * Options for {@link fireSystemNotification}.
 */
export interface SystemNotificationOptions {
  /** Title shown in the OS notification. */
  title: string
  /** Optional body text. Keep it short (< 120 chars). */
  body?: string
  /**
   * Event key used to filter against the per-event toggle from
   * `probe_push_events` in Settings. If provided AND the user has
   * disabled this event, the notification is silently dropped.
   * If omitted, the per-event filter is bypassed.
   */
  event?: string
  /**
   * Notification tag / group — same value replaces the previous one
   * instead of stacking. Useful for "AI error" so you don't get 5
   * notifications for 5 consecutive errors. Maps to Tauri's `group`
   * and to the browser `Notification.tag`.
   */
  tag?: string
  /** Optional icon URL. */
  icon?: string
}

let cachedTauriPermission: boolean | null = null

/**
 * Clears the cached Tauri permission state. Call after
 * `requestPermission()` so the next fire picks up the new value
 * without re-querying the plugin.
 */
export function resetSystemNotificationPermissionCache(): void {
  cachedTauriPermission = null
}

async function checkTauriPermission(): Promise<boolean> {
  if (cachedTauriPermission !== null) return cachedTauriPermission
  try {
    const { isPermissionGranted } = await import("@tauri-apps/plugin-notification")
    cachedTauriPermission = await isPermissionGranted()
  } catch {
    cachedTauriPermission = false
  }
  return cachedTauriPermission
}

/**
 * Fires an OS-level notification, gated by user preferences.
 *
 * Automatically branches between:
 *  - **Tauri desktop**: uses `@tauri-apps/plugin-notification` (native OS).
 *  - **Browser**: uses the standard `Notification` API.
 *
 * Silently no-ops when:
 *  - running on the server
 *  - the runtime doesn't support notifications
 *  - permission is not granted
 *  - the master toggle `probe_system_push_enabled` is "false"
 *  - a per-event toggle (`probe_push_events[event]`) is false
 *  - (browser only) the document is currently visible — the toast handles it
 *
 * This helper is intentionally safe to call from anywhere — it never throws
 * and returns a resolved Promise.
 */
export async function fireSystemNotification(
  opts: SystemNotificationOptions,
): Promise<void> {
  if (typeof window === "undefined") return

  // Master toggle — opt-in (default off until user enables)
  const masterRaw = persistence.getItem<string | boolean>("probe_system_push_enabled")
  if (masterRaw === false || masterRaw === "false") return

  // Per-event filter (only if an event key was supplied)
  if (opts.event) {
    const raw = persistence.getItem<Record<string, boolean> | string>("probe_push_events")
    if (raw) {
      const events = typeof raw === "string" ? JSON.parse(raw) : raw
      if (events && events[opts.event] === false) return
    }
  }

  try {
    if (isTauriAvailable()) {
      const granted = await checkTauriPermission()
      if (!granted) return
      const { sendNotification } = await import("@tauri-apps/plugin-notification")
      sendNotification({
        title: opts.title,
        body: opts.body,
        group: opts.tag ?? opts.event,
        icon: opts.icon,
      })
      return
    }

    // Browser path
    if (typeof Notification === "undefined") return
    if (Notification.permission !== "granted") return
    // Avoid duplicating toasts when user is already looking at the tab.
    // In Tauri the user may be on another native app, so we always fire.
    if (typeof document !== "undefined" && document.visibilityState === "visible") return
    new Notification(opts.title, {
      body: opts.body,
      tag: opts.tag ?? opts.event,
      icon: opts.icon ?? "/favicon.ico",
    })
  } catch {
    // Some browsers (Safari, embedded webviews) throw on construction;
    // never let a notification failure bubble up to the caller.
  }
}

/**
 * Options for {@link pushInAppNotification}.
 */
export interface InAppNotificationOptions {
  /** Notification title shown in the bell dropdown. */
  title: string
  /** Optional body text. */
  body?: string
  /** Visual style. Defaults to "info". */
  type?: "info" | "success" | "warning" | "error"
  /**
   * Event key used to filter against the per-event toggle from
   * `probe_push_events` in Settings. If the user has disabled this event,
   * the notification is silently dropped. If omitted, the per-event filter
   * is bypassed (use sparingly — only for things that should always show).
   */
  event?: string
}

/**
 * Pushes a notification into the in-app bell dropdown (the modal).
 *
 * This is the persistent counterpart to {@link fireSystemNotification}:
 *  - {@link fireSystemNotification} → OS notification (visible when not on the tab/window)
 *  - {@link pushInAppNotification}   → entry in the bell modal (persistent history)
 *
 * Both helpers respect the same per-event toggle from `probe_push_events`,
 * so a user who unchecks "AI error" will see neither a toast, an OS
 * notification, NOR an in-app entry for AI errors.
 *
 * The master toast/system toggles do NOT affect this helper — the bell
 * modal is the user's history and should always reflect what happened.
 *
 * Safe to call from anywhere — never throws.
 */
export function pushInAppNotification(opts: InAppNotificationOptions): void {
  if (typeof window === "undefined") return

  // Per-event filter — drop if user disabled this event category
  if (opts.event) {
    const raw = persistence.getItem<Record<string, boolean> | string>("probe_push_events")
    if (raw) {
      const events = typeof raw === "string" ? JSON.parse(raw) : raw
      if (events && events[opts.event] === false) return
    }
  }

  try {
    const notification: Notification = {
      id: crypto.randomUUID(),
      title: opts.title,
      body: opts.body,
      type: opts.type ?? "info",
      event: opts.event,
      read: false,
      createdAt: Date.now(),
    }
    moduleLevelCommit((prev) => ({
      ...prev,
      notifications: [...prev.notifications, notification],
    }))
  } catch {
    // Never let a notification push fail the caller (e.g. crypto.randomUUID
    // unavailable in ancient browsers, store locked, etc.)
  }
}

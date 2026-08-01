import type { RequestStore, Notification } from "@/hooks/request-types"
import { isTauriAvailable } from "@/lib/tauri"
import { resetSystemNotificationPermissionCache } from "@/lib/system-notifications"
import { CommitFn } from "./types"

export function createNotificationsMutations(commit: CommitFn) {
  const addNotification = (
    notification: Omit<Notification, "id" | "read" | "createdAt"> & {
      id?: string
      read?: boolean
      createdAt?: number
    },
  ) => {
    const newNotification: Notification = {
      ...notification,
      id: notification.id ?? crypto.randomUUID(),
      read: notification.read ?? false,
      createdAt: notification.createdAt ?? Date.now(),
    }

    commit((prev: RequestStore) => ({
      ...prev,
      notifications: [...prev.notifications, newNotification],
    }))
    // Note: toast is NOT called here — it's the caller's responsibility.
    // The store notification and toast are intentionally decoupled.
  }

  const markNotificationRead = (
    id: string) => {
      commit((prev: RequestStore) => ({
        ...prev,
        notifications: prev.notifications.map((n) =>
          n.id === id ? { ...n, read: true } : n,
        ),
      }))
    }

  const removeNotification = (id: string) => {
    commit((prev: RequestStore) => ({
      ...prev,
      notifications: prev.notifications.filter((n) => n.id !== id),
    }))
  }

  const clearNotifications = () => {
    commit((prev: RequestStore) => ({
      ...prev,
      notifications: [],
    }))
  }

  const requestSystemNotificationPermission = async () => {
    resetSystemNotificationPermissionCache()

    if (isTauriAvailable()) {
      try {
        const { isPermissionGranted, requestPermission } = await import(
          "@tauri-apps/plugin-notification"
        )
        let granted = await isPermissionGranted()
        let result: NotificationPermission
        if (granted) {
          result = "granted"
        } else {
          result = await requestPermission()
          granted = result === "granted"
        }
        // Refresh the cache so the next fireSystemNotification picks up the change
        resetSystemNotificationPermissionCache()
        commit((prev: RequestStore) => ({
          ...prev,
          systemNotificationPermission: granted ? "granted" : (result as string),
        }))
        return result
      } catch {
        commit((prev: RequestStore) => ({
          ...prev,
          systemNotificationPermission: "unsupported",
        }))
        return "unsupported" as const
      }
    }

    if (!("Notification" in window)) {
      commit((prev: RequestStore) => ({
        ...prev,
        systemNotificationPermission: "unsupported",
      }))
      return "unsupported" as const
    }

    const result = await Notification.requestPermission()
    commit((prev: RequestStore) => ({
      ...prev,
      systemNotificationPermission: result,
    }))
    return result
  }

  return {
    addNotification,
    markNotificationRead,
    removeNotification,
    clearNotifications,
    requestSystemNotificationPermission,
  }
}

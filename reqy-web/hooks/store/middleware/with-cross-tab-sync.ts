export interface SyncPayload {
  type: "update"
  gen: number
}

export interface CrossTabSyncInstance {
  onMessage: (handler: (payload: SyncPayload) => void) => void
  broadcast: (payload: SyncPayload) => void
  listenStorage: (key: string, handler: (value: string) => void) => () => void
  cleanup: () => void
}

export function withCrossTabSync(channelName: string): CrossTabSyncInstance {
  let channel: BroadcastChannel | null = null
  let messageHandler: ((payload: SyncPayload) => void) | null = null

  try {
    channel = new BroadcastChannel(channelName)
    channel.onmessage = (event) => {
      messageHandler?.(event.data)
    }
  } catch {
    channel = null
  }

  return {
    onMessage(handler: (payload: SyncPayload) => void) {
      messageHandler = handler
    },

    broadcast(payload: SyncPayload) {
      if (channel) {
        channel.postMessage(payload)
      }
    },

    listenStorage(key: string, handler: (value: string) => void) {
      const onStorage = (e: StorageEvent) => {
        if (e.key === key && e.newValue) {
          handler(e.newValue)
        }
      }
      if (typeof window !== "undefined") {
        window.addEventListener("storage", onStorage)
      }
      return () => {
        if (typeof window !== "undefined") {
          window.removeEventListener("storage", onStorage)
        }
      }
    },

    cleanup() {
      channel?.close()
    },
  }
}

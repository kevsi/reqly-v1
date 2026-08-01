"use client"

import { useState, useEffect, useCallback } from "react"
import { persistence } from "@/lib/persistence"

function loadCollapsedState(storageKey: string, collectionId: string): Set<string> {
  try {
    const raw = persistence.getItem<string>(storageKey)
    if (!raw) return new Set()
    const all = JSON.parse(raw) as Record<string, string[]>
    return new Set(all[collectionId] ?? [])
  } catch {
    return new Set()
  }
}

function saveCollapsedState(storageKey: string, collectionId: string, set: Set<string>) {
  try {
    const raw = persistence.getItem<string>(storageKey)
    const all: Record<string, string[]> = raw ? JSON.parse(raw) : {}
    all[collectionId] = [...set]
    void persistence.setItem(storageKey, JSON.stringify(all))
  } catch {
    // intentionally empty
  }
}

export function usePersistedSet(
  storageKey: string,
  collectionId: string
): [Set<string>, (setFn: (prev: Set<string>) => Set<string>) => void] {
  const [value, setValue] = useState<Set<string>>(() =>
    loadCollapsedState(storageKey, collectionId)
  )

  // Persist whenever the set changes
  useEffect(() => {
    saveCollapsedState(storageKey, collectionId, value)
  }, [storageKey, collectionId, value])

  const update = useCallback(
    (setFn: (prev: Set<string>) => Set<string>) => {
      setValue((prev) => setFn(prev))
    },
    []
  )

  return [value, update]
}

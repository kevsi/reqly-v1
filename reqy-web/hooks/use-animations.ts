"use client"

import { useCallback, useEffect, useState } from "react"
import { persistence } from "@/lib/persistence"

const STORAGE_KEY = "reqly-animations"

export interface UseAnimationsReturn {
  enabled: boolean
  toggle: () => void
  setEnabled: (v: boolean) => void
}

function readInitial(): boolean {
  if (typeof window === "undefined") return true
  try {
    const stored = persistence.getItem<string>(STORAGE_KEY)
    if (stored === "off") return false
  } catch {
    /* ignore */
  }
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

function applyClass(enabled: boolean) {
  if (typeof document === "undefined") return
  if (enabled) {
    document.body.removeAttribute("data-animations")
  } else {
    document.body.setAttribute("data-animations", "off")
  }
}

export function useAnimations(): UseAnimationsReturn {
  const [enabled, setEnabledState] = useState<boolean>(true)

  useEffect(() => {
    const initial = readInitial()
    setEnabledState(initial)
    applyClass(initial)
  }, [])

  const setEnabled = useCallback((v: boolean) => {
    setEnabledState(v)
    applyClass(v)
    try {
      void persistence.setItem(STORAGE_KEY, v ? "on" : "off")
    } catch {
      /* ignore */
    }
  }, [])

  const toggle = useCallback(() => setEnabled(!enabled), [enabled, setEnabled])

  return { enabled, toggle, setEnabled }
}

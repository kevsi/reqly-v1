"use client"

import { useCallback, useEffect, useState } from "react"
import { persistence } from "@/lib/persistence"

const STORAGE_KEY = "reqly-accent"

export const ACCENT_PRESETS = [
  { id: "black", label: "Noir", hex: "#000000" },
  { id: "red", label: "Rouge", hex: "#EF4444" },
  { id: "green", label: "Vert", hex: "#10B981" },
  { id: "blue", label: "Bleu", hex: "#3B82F6" },
  { id: "purple", label: "Violet", hex: "#8B5CF6" },
] as const

export const HEX_REGEX = /^#[0-9A-Fa-f]{6}$/

export interface UseAccentReturn {
  accent: string | null
  setAccent: (hex: string | null) => void
  isPreset: (hex: string) => boolean
  presets: typeof ACCENT_PRESETS
}

function applyAccent(hex: string | null) {
  if (typeof document === "undefined") return
  const root = document.documentElement
  if (hex && HEX_REGEX.test(hex)) {
    root.style.setProperty("--primary", hex)
  } else {
    root.style.removeProperty("--primary")
  }
}

export function useAccent(): UseAccentReturn {
  const [accent, setAccentState] = useState<string | null>(null)

  useEffect(() => {
    try {
      const stored = persistence.getItem<string>(STORAGE_KEY)
      if (stored && HEX_REGEX.test(stored)) {
        setAccentState(stored)
        applyAccent(stored)
      }
    } catch {
      /* ignore */
    }
  }, [])

  const setAccent = useCallback((hex: string | null) => {
    if (hex !== null && !HEX_REGEX.test(hex)) return
    setAccentState(hex)
    applyAccent(hex)
    try {
      if (hex) void persistence.setItem(STORAGE_KEY, hex)
      else void persistence.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
  }, [])

  const isPreset = useCallback(
    (hex: string) => ACCENT_PRESETS.some((p) => p.hex.toLowerCase() === hex.toLowerCase()),
    []
  )

  return { accent, setAccent, isPreset, presets: ACCENT_PRESETS }
}

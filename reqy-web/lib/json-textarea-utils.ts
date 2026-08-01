import type { KeyboardEvent } from "react"

const BRACKET_PAIRS: Record<string, string> = {
  "{": "}",
  "[": "]",
  "(": ")",
}

const QUOTE_CHARS = new Set(['"', "'"])

const CLOSING_CHARS = new Set([...Object.values(BRACKET_PAIRS), ...QUOTE_CHARS])

type TextInputElement = HTMLTextAreaElement | HTMLInputElement

function setCursor(el: TextInputElement, pos: number) {
  requestAnimationFrame(() => {
    el.setSelectionRange(pos, pos)
    el.focus()
  })
}

export function applyJsonTextareaKeyDown(
  e: KeyboardEvent<TextInputElement>,
  value: string,
  onValueChange: (next: string) => void,
): boolean {
  const el = e.currentTarget
  const start = el.selectionStart ?? 0
  const end = el.selectionEnd ?? 0
  const hasSelection = start !== end
  const charAfter = value[start]

  if (!e.ctrlKey && !e.metaKey && !e.altKey) {
    if (!hasSelection && CLOSING_CHARS.has(e.key) && charAfter === e.key) {
      e.preventDefault()
      setCursor(el, start + 1)
      return true
    }

    if (!hasSelection && e.key in BRACKET_PAIRS) {
      e.preventDefault()
      const close = BRACKET_PAIRS[e.key]
      const next = value.slice(0, start) + e.key + close + value.slice(end)
      onValueChange(next)
      setCursor(el, start + 1)
      return true
    }

    if (!hasSelection && QUOTE_CHARS.has(e.key)) {
      if (charAfter === e.key) {
        e.preventDefault()
        setCursor(el, start + 1)
        return true
      }
      e.preventDefault()
      const next = value.slice(0, start) + e.key + e.key + value.slice(end)
      onValueChange(next)
      setCursor(el, start + 1)
      return true
    }

    if (e.key === "Backspace" && !hasSelection && start > 0) {
      const open = value[start - 1]
      const close = value[start]
      const isBracketPair = open in BRACKET_PAIRS && BRACKET_PAIRS[open] === close
      const isQuotePair = QUOTE_CHARS.has(open) && open === close
      if (isBracketPair || isQuotePair) {
        e.preventDefault()
        const next = value.slice(0, start - 1) + value.slice(start + 1)
        onValueChange(next)
        setCursor(el, start - 1)
        return true
      }
    }
  }

  return false
}

export function createJsonKeyDownHandler(
  value: string,
  onValueChange: (next: string) => void,
) {
  return (e: KeyboardEvent<TextInputElement>) => {
    applyJsonTextareaKeyDown(e, value, onValueChange)
  }
}

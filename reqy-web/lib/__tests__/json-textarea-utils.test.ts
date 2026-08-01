import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { applyJsonTextareaKeyDown } from "@/lib/json-textarea-utils"

function makeEvent(
  key: string,
  value: string,
  selectionStart: number,
  selectionEnd = selectionStart,
) {
  const el = {
    value,
    selectionStart,
    selectionEnd,
    setSelectionRange: vi.fn((start: number) => {
      el.selectionStart = start
      el.selectionEnd = start
    }),
    focus: vi.fn(),
  }

  return {
    key,
    currentTarget: el,
    preventDefault: vi.fn(),
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
  } as unknown as React.KeyboardEvent<HTMLTextAreaElement>
}

describe("applyJsonTextareaKeyDown", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0)
      return 0
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("inserts paired braces", () => {
    const onChange = vi.fn()
    const e = makeEvent("{", "", 0)
    const handled = applyJsonTextareaKeyDown(e, "", onChange)
    expect(handled).toBe(true)
    expect(onChange).toHaveBeenCalledWith("{}")
    expect(e.preventDefault).toHaveBeenCalled()
  })

  it("inserts paired double quotes", () => {
    const onChange = vi.fn()
    const e = makeEvent('"', "{", 1)
    const handled = applyJsonTextareaKeyDown(e, "{", onChange)
    expect(handled).toBe(true)
    expect(onChange).toHaveBeenCalledWith('{""')
  })

  it("skips over an existing closing quote", () => {
    const onChange = vi.fn()
    const e = makeEvent('"', '{"x":""}', 5)
    const handled = applyJsonTextareaKeyDown(e, '{"x":""}', onChange)
    expect(handled).toBe(true)
    expect(onChange).not.toHaveBeenCalled()
    expect(e.currentTarget.selectionStart).toBe(6)
  })

  it("removes empty quote pairs on backspace", () => {
    const onChange = vi.fn()
    const e = makeEvent("Backspace", '{"":1}', 2)
    const handled = applyJsonTextareaKeyDown(e, '{"":1}', onChange)
    expect(handled).toBe(true)
    expect(onChange).toHaveBeenCalledWith("{:1}")
  })
})

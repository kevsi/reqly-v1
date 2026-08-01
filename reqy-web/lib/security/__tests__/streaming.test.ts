import { describe, it, expect } from "vitest"
import { readWithCap } from "../streaming"

/**
 * Streaming response reader with a byte cap — unit tests.
 *
 * Builds a fake `ReadableStreamDefaultReader` from an array of chunks so we
 * can exercise the cap logic without spinning up a real HTTP response.
 */

interface FakeReader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>
  cancel(): Promise<void>
  releaseLock(): void
}

function makeFakeReader(chunks: Uint8Array[]): FakeReader {
  let i = 0
  let released = false
  let cancelled = false
  return {
    async read() {
      if (cancelled || released) return { done: true }
      if (i >= chunks.length) return { done: true }
      const value = chunks[i++]
      return { done: false, value }
    },
    async cancel() {
      cancelled = true
    },
    releaseLock() {
      released = true
    },
  }
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

describe("readWithCap", () => {
  it("returns the full body when under the cap", async () => {
    const chunks = [utf8("hello "), utf8("world")]
    const reader = makeFakeReader(chunks) as unknown as ReadableStreamDefaultReader<Uint8Array>
    const r = await readWithCap(reader, 1024)
    expect(r.truncated).toBe(false)
    expect(r.size).toBe(11)
    expect(r.body.toString("utf8")).toBe("hello world")
  })

  it("truncates at the cap when a single chunk exceeds it", async () => {
    const huge = new Uint8Array(2048).fill(0x41) // 2 KB of 'A'
    const reader = makeFakeReader([huge]) as unknown as ReadableStreamDefaultReader<Uint8Array>
    const r = await readWithCap(reader, 100)
    expect(r.truncated).toBe(true)
    expect(r.size).toBe(100)
    expect(r.body.byteLength).toBe(100)
  })

  it("truncates when combined chunks exceed the cap", async () => {
    const a = new Uint8Array(80).fill(0x41) // 'A' * 80
    const b = new Uint8Array(80).fill(0x42) // 'B' * 80
    const reader = makeFakeReader([a, b]) as unknown as ReadableStreamDefaultReader<Uint8Array>
    const r = await readWithCap(reader, 100)
    expect(r.truncated).toBe(true)
    expect(r.size).toBe(100)
    expect(r.body.byteLength).toBe(100)
  })

  it("keeps the partial chunk that fits when truncating mid-chunk", async () => {
    const a = new Uint8Array(50).fill(0x41) // 'A' * 50
    const b = new Uint8Array(200).fill(0x42) // 'B' * 200
    const reader = makeFakeReader([a, b]) as unknown as ReadableStreamDefaultReader<Uint8Array>
    const r = await readWithCap(reader, 100)
    expect(r.truncated).toBe(true)
    expect(r.size).toBe(100)
    // First 50 bytes are 'A', next 50 bytes are 'B' (partial second chunk)
    expect(r.body[0]).toBe(0x41)
    expect(r.body[49]).toBe(0x41)
    expect(r.body[50]).toBe(0x42)
    expect(r.body[99]).toBe(0x42)
  })

  it("returns empty body when stream yields no chunks", async () => {
    const reader = makeFakeReader([]) as unknown as ReadableStreamDefaultReader<Uint8Array>
    const r = await readWithCap(reader, 1024)
    expect(r.truncated).toBe(false)
    expect(r.size).toBe(0)
    expect(r.body.byteLength).toBe(0)
  })

  it("tolerates cap of 0 (no body allowed)", async () => {
    const chunks = [utf8("anything")]
    const reader = makeFakeReader(chunks) as unknown as ReadableStreamDefaultReader<Uint8Array>
    const r = await readWithCap(reader, 0)
    expect(r.truncated).toBe(true)
    expect(r.size).toBe(0)
  })

  it("never returns more bytes than the cap, even if more are available", async () => {
    const chunks = [
      new Uint8Array(10).fill(1),
      new Uint8Array(10).fill(2),
      new Uint8Array(10).fill(3),
    ]
    const reader = makeFakeReader(chunks) as unknown as ReadableStreamDefaultReader<Uint8Array>
    const r = await readWithCap(reader, 15)
    expect(r.truncated).toBe(true)
    expect(r.size).toBe(15)
    expect(r.body.byteLength).toBe(15)
  })
})

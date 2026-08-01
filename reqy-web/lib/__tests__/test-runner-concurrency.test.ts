import { describe, it, expect, vi } from "vitest"
import { runRequestsConcurrent } from "@/lib/test-runner/executor"

describe("runRequestsConcurrent", () => {
  it("preserves input order in the output array", async () => {
    const requests = Array.from({ length: 5 }, (_, i) => ({
      method: "GET",
      url: `https://example.com/${i}`,
      headers: {},
    }))
    // Mock executeDirect path: serverSide=true makes it call fetch directly.
    // We stub fetch so it always returns a JSON body with the URL echoed back.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input)
      // Simulate variable latency to prove ordering is NOT done by timing.
      await new Promise((r) => setTimeout(r, Math.random() * 20))
      return new Response(JSON.stringify({ url }), { status: 200, headers: { "Content-Type": "application/json" } })
    })

    const results = await runRequestsConcurrent(requests, { serverSide: true, concurrency: 3 })

    expect(results).toHaveLength(5)
    for (let i = 0; i < 5; i++) {
      expect(results[i].ok).toBe(true)
      if (results[i].ok) {
        const body = results[i].response.body as { url: string }
        expect(body.url).toBe(`https://example.com/${i}`)
      }
    }
    fetchSpy.mockRestore()
  })

  it("isolates errors per request (one failure does not abort the batch)", async () => {
    const requests = [
      { method: "GET", url: "https://example.com/ok", headers: {} },
      { method: "GET", url: "https://example.com/fail", headers: {} },
      { method: "GET", url: "https://example.com/ok2", headers: {} },
    ]
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes("fail")) {
        return new Response("boom", { status: 500, headers: { "Content-Type": "text/plain" } })
      }
      return new Response(JSON.stringify({ url }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    })

    const results = await runRequestsConcurrent(requests, { serverSide: true, concurrency: 2 })
    expect(results).toHaveLength(3)
    expect(results[0].ok).toBe(true)
    expect(results[1].ok).toBe(false)
    if (!results[1].ok) {
      expect(results[1].error).toBeTruthy()
    }
    expect(results[2].ok).toBe(true)
    fetchSpy.mockRestore()
  })

  it("respects the concurrency limit (never runs more than N in parallel)", async () => {
    const requests = Array.from({ length: 8 }, (_, i) => ({
      method: "GET",
      url: `https://example.com/${i}`,
      headers: {},
    }))

    let inFlight = 0
    let maxInFlight = 0
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 30))
      inFlight--
      return new Response(JSON.stringify({ url: String(input) }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    })

    await runRequestsConcurrent(requests, { serverSide: true, concurrency: 2 })
    expect(maxInFlight).toBeLessThanOrEqual(2)
    fetchSpy.mockRestore()
  })

  it("returns an empty array when given no requests", async () => {
    const results = await runRequestsConcurrent([], { serverSide: true })
    expect(results).toEqual([])
  })

  it("clamps concurrency to 1 when set to 0 or negative", async () => {
    const requests = Array.from({ length: 3 }, (_, i) => ({
      method: "GET",
      url: `https://example.com/${i}`,
      headers: {},
    }))
    let inFlight = 0
    let maxInFlight = 0
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } })
    })
    await runRequestsConcurrent(requests, { serverSide: true, concurrency: 0 })
    expect(maxInFlight).toBe(1)
    fetchSpy.mockRestore()
  })
})

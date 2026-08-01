/**
 * DNS resolution cache for the SSRF guard.
 *
 * The proxy issues one `dns.lookup()` per outbound request to validate the
 * resolved IP against the SSRF blocklist. For high-traffic targets (e.g.
 * `api.github.com`, `jsonplaceholder.typicode.com`), this adds a synchronous
 * round-trip to every request.
 *
 * This module wraps `node:dns/promises` with a small in-memory LRU + TTL.
 * On serverless/Edge the cache is per-instance (cold start = empty cache),
 * which is the same trade-off as the in-memory rate limiter fallback.
 *
 * Configuration:
 *   - TTL: 60 seconds (matches the public-DNS TTL floor; long enough to
 *     absorb bursts, short enough to pick up DNS changes quickly).
 *   - Max entries: 256 (well under memory pressure; ~256 × ~80 bytes ≈ 20 KB).
 *   - Eviction: lazy on access + best-effort periodic sweep.
 */

import * as dns from "node:dns/promises"

const DEFAULT_TTL_MS = 60_000
const DEFAULT_MAX_ENTRIES = 256

interface CacheEntry {
  address: string
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()
let lastSweepAt = Date.now()

function sweepIfStale(now: number): void {
  // Sweep at most every 30 s. Walk the map and delete expired entries.
  if (now - lastSweepAt < 30_000) return
  lastSweepAt = now
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key)
  }
}

function evictIfFull(): void {
  while (cache.size >= DEFAULT_MAX_ENTRIES) {
    // Map iteration order is insertion order — evict the oldest entry.
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

/**
 * Resolve a hostname to its first A/AAAA address, with caching.
 *
 * Returns null on DNS failure (ENOTFOUND, etc.) so the caller can decide
 * whether to abort the request or fall back to the hostname-only check.
 */
export async function resolveCached(hostname: string): Promise<string | null> {
  const now = Date.now()
  sweepIfStale(now)

  const cached = cache.get(hostname)
  if (cached && cached.expiresAt > now) {
    // Refresh position in the LRU: delete + re-insert moves to the end.
    cache.delete(hostname)
    cache.set(hostname, cached)
    return cached.address
  }

  let address: string
  try {
    const result = await dns.lookup(hostname, { all: false })
    address = result.address
  } catch {
    return null
  }

  evictIfFull()
  cache.set(hostname, { address, expiresAt: now + DEFAULT_TTL_MS })
  return address
}

/** Test-only: clear the cache. */
export function _clearDnsCache(): void {
  cache.clear()
  lastSweepAt = Date.now()
}

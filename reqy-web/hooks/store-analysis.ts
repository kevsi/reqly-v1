"use client"

import type { RequestStore } from "./request-types"
import { toast } from "@/hooks/use-toast"
import { persistence } from "@/lib/persistence"

const DISMISSED_ALERTS_KEY = "reqly-dismissed-alerts"

function getDismissedAlerts(): Set<string> {
  try {
    const raw = persistence.getItem<string>(DISMISSED_ALERTS_KEY)
    if (raw) return new Set(JSON.parse(raw))
  } catch {
    // intentionally empty
  }
  return new Set()
}

function addDismissedAlert(hash: string): void {
  try {
    const alerts = getDismissedAlerts()
    alerts.add(hash)
    void persistence.setItem(DISMISSED_ALERTS_KEY, JSON.stringify(Array.from(alerts)))
  } catch {
    // intentionally empty
  }
}

function hashAlert(type: string, key: string): string {
  return `${type}::${key}`
}

/** True if the URL looks like a pattern with placeholders (e.g. /api/users/:id). */
function isPatternEndpoint(url: string): boolean {
  return /\/:[a-zA-Z_][a-zA-Z0-9_]*|{[\w-]+}/.test(url)
}

/** Throttle: skip analysis if called within this many ms of the last run. */
let lastAnalysisTime = 0
const ANALYSIS_THROTTLE_MS = 2_000

/**
 * Proactive notifications — runs once on app load, throttled to at most once per 2s.
 *
 * Rules:
 * 1. Any endpoint whose avg response time is ≥130% of its own historical baseline
 * 2. Any endpoint with error rate > 20% over the last 10 calls
 * 3. Any collection not used (no requests) for more than 7 days
 */
export function runProactiveAnalysis(store: RequestStore) {
  // Throttle: skip if called too soon
  const now = Date.now()
  if (now - lastAnalysisTime < ANALYSIS_THROTTLE_MS) return
  lastAnalysisTime = now

  try {
    const { history, collections } = store
    if (!history.length) return

    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
    const ERROR_THRESHOLD = 0.2
    const SLOW_THRESHOLD = 1.3

    const dismissed = getDismissedAlerts()

    /* ── 1. Group history by endpoint (skip pattern endpoints) ── */
    const endpointMap = new Map<string, { times: number[]; statuses: number[]; lastUsed: number }>()
    for (const item of history) {
      const key = item.endpoint || item.url || "Unknown"
      if (isPatternEndpoint(key)) continue // skip template patterns like /api/users/:id
      if (!endpointMap.has(key)) endpointMap.set(key, { times: [], statuses: [], lastUsed: 0 })
      const bucket = endpointMap.get(key)!
      if (item.responseTime != null) bucket.times.push(item.responseTime)
      if (item.responseStatus != null) bucket.statuses.push(item.responseStatus)
      if (item.executedAt > bucket.lastUsed) bucket.lastUsed = item.executedAt
    }

    /* ── 2. Slow endpoints (last 3 calls vs all-time average) ── */
    for (const [endpoint, data] of endpointMap.entries()) {
      if (data.times.length < 3) continue
      const allAvg = data.times.reduce((s, t) => s + t, 0) / data.times.length
      const recent3 = data.times.slice(-3)
      const recentAvg = recent3.reduce((s, t) => s + t, 0) / recent3.length
      if (recentAvg >= allAvg * SLOW_THRESHOLD) {
        const hash = hashAlert("slow", endpoint)
        if (dismissed.has(hash)) continue
        toast({
          title: `⚠️ Slow endpoint detected`,
          description: `${endpoint} responds ~${Math.round(recentAvg)}ms on average (normal: ~${Math.round(allAvg)}ms, +${Math.round((recentAvg / allAvg - 1) * 100)}%).`,
          variant: "default",
          onClick: () => addDismissedAlert(hash),
        })
      }
    }

    /* ── 3. High error rate (last 10 calls) ── */
    for (const [endpoint, data] of endpointMap.entries()) {
      const last10 = data.statuses.slice(-10)
      if (last10.length < 3) continue
      const errorCount = last10.filter((s) => s >= 400).length
      const errorRate = errorCount / last10.length
      if (errorRate > ERROR_THRESHOLD) {
        const hash = hashAlert("error", endpoint)
        if (dismissed.has(hash)) continue
        toast({
          title: `🔴 High error rate`,
          description: `${endpoint} has ${Math.round(errorRate * 100)}% errors over the last ${last10.length} calls.`,
          variant: "destructive",
          onClick: () => addDismissedAlert(hash),
        })
      }
    }

    /* ── 4. Stale collections (unused > 7 days) ── */
    for (const collection of collections) {
      if (!collection.requests.length) continue
      let lastUsed = collection.updatedAt
      for (const request of collection.requests) {
        const matchedRequests = history.filter(
          (item) => item.endpoint === request.endpoint || item.url === request.url
        )
        if (matchedRequests.length) {
          const latest = Math.max(...matchedRequests.map((item) => item.executedAt))
          lastUsed = Math.max(lastUsed, latest)
        }
      }
      if (now - lastUsed > SEVEN_DAYS_MS) {
        const daysAgo = Math.floor((now - lastUsed) / (24 * 60 * 60 * 1000))
        const hash = hashAlert("stale", collection.id)
        if (dismissed.has(hash)) continue
        toast({
          title: `📁 Inactive collection`,
          description: `"${collection.name}" has not been used for ${daysAgo} days.`,
          variant: "default",
          onClick: () => addDismissedAlert(hash),
        })
      }
    }
  } catch {
    /* silently ignore analysis errors */
  }
}

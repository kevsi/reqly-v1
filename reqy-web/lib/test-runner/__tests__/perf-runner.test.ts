import { describe, it, expect, vi } from "vitest";
import { runPerformanceStages, type PerfRequestSpec, type PerfStage } from "../perf-runner";
import type { RequestResponse } from "@/lib/test-runner/types";

function spec(overrides: Partial<PerfRequestSpec> = {}): PerfRequestSpec {
  return {
    id: "r1",
    name: "GET /health",
    method: "GET",
    url: "https://example.test/health",
    headers: {},
    ...overrides,
  };
}

function okResponse(responseTimeMs: number): RequestResponse {
  return { statusCode: 200, responseTimeMs, body: { ok: true }, headers: {} };
}

/**
 * Exécuteur factice : latence contrôlée par file d'attente, sans réseau.
 * Le délai réel (2 ms) borne le nombre d'itérations — avec un exécuteur
 * instantané, les workers génèreraient des millions de mesures et un OOM
 * en test, ce qui n'arrive pas face à un vrai serveur (latence réseau).
 */
function fakeExecutor(latencies: number[], statusCode = 200) {
  let call = 0;
  return vi.fn(async (): Promise<RequestResponse> => {
    const latency = latencies[call % latencies.length];
    call += 1;
    await new Promise((resolve) => setTimeout(resolve, 2));
    return { statusCode, responseTimeMs: latency, body: null, headers: {} };
  });
}

/** Durées de stage minuscules : le moteur boucle tant que Date.now() le permet. */
const SHORT_STAGES: PerfStage[] = [{ durationSec: 1, targetVus: 2 }];

describe("runPerformanceStages", () => {
  it("aggregates per-request stats and global percentiles", async () => {
    const execute = fakeExecutor([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
    const report = await runPerformanceStages([spec(), spec({ id: "r2", name: "POST /x" })], {
      stages: [{ durationSec: 1, targetVus: 3 }],
      execute,
    });

    expect(report.totalRequests).toBeGreaterThan(0);
    expect(report.totalRequests).toBe(report.perRequest.reduce((s, r) => s + r.count, 0));
    expect(report.p50Ms).toBeGreaterThanOrEqual(report.minMs);
    expect(report.p99Ms).toBeLessThanOrEqual(report.maxMs);
    expect(report.p95Ms).toBeGreaterThanOrEqual(report.p50Ms);
    expect(report.peakVus).toBe(3);
    expect(report.throughputRps).toBeGreaterThan(0);
    expect(report.stages).toHaveLength(1);
    expect(report.stages[0].requests).toBe(report.totalRequests);
    expect(report.failedRequests).toBe(0);
  });

  it("counts HTTP >= 400 as failures", async () => {
    const execute = fakeExecutor([50], 500);
    const report = await runPerformanceStages([spec()], { stages: SHORT_STAGES, execute });
    expect(report.failedRequests).toBe(report.totalRequests);
    expect(report.failedRequests).toBeGreaterThan(0);
  });

  it("counts transport errors as failures without aborting the run", async () => {
    let call = 0;
    const execute = vi.fn(async () => {
      call += 1;
      await new Promise((resolve) => setTimeout(resolve, 2));
      if (call % 2 === 0) throw new Error("boom");
      return okResponse(20);
    });
    const report = await runPerformanceStages([spec()], { stages: SHORT_STAGES, execute });
    expect(report.totalRequests).toBeGreaterThan(0);
    // La parité exacte n'est pas garantie en concurrence (workers multiples
    // incrémentent le compteur avant l'await) : on vérifie la proportion.
    expect(report.failedRequests).toBeGreaterThan(0);
    expect(report.failedRequests).toBeLessThan(report.totalRequests);
  }, 20_000);

  it("evaluates assertions on every response", async () => {
    const execute = fakeExecutor([10]);
    const report = await runPerformanceStages(
      [
        spec({
          assertions: [
            { type: "status", expected: 200 },
            { type: "status", expected: 404 },
          ],
        }),
      ],
      { stages: SHORT_STAGES, execute },
    );
    expect(report.assertionSummary.total).toBe(report.totalRequests * 2);
    expect(report.assertionSummary.passed).toBe(report.totalRequests);
    expect(report.assertionSummary.failed).toBe(report.totalRequests);
    const stats = report.perRequest[0];
    expect(stats.assertionsPassed).toBe(stats.count);
    expect(stats.assertionsFailed).toBe(stats.count);
  });

  it("normalizes invalid stages (min 1s, min 1 VU, max 10 stages)", async () => {
    const execute = fakeExecutor([5]);
    const report = await runPerformanceStages([spec()], {
      stages: [
        { durationSec: 0, targetVus: 0 },
        ...Array.from({ length: 15 }, (_, i) => ({ durationSec: 1, targetVus: i + 1 })),
      ],
      execute,
    });
    // 0 → clampé à 1, et seuls les 10 premiers stages sont conservés.
    expect(report.stages).toHaveLength(10);
    expect(report.stages[0].durationSec).toBe(1);
    expect(report.stages[0].targetVus).toBe(1);
  }, 30_000);

  it("falls back to a single 10s/1VU stage when none is provided", async () => {
    const execute = fakeExecutor([5]);
    const report = await runPerformanceStages([spec()], { stages: [], execute });
    expect(report.stages).toEqual([
      expect.objectContaining({ durationSec: 10, targetVus: 1 }),
    ]);
  }, 30_000);

  it("stops early when the abort signal fires", async () => {
    const controller = new AbortController();
    const execute = fakeExecutor([5]);
    const promise = runPerformanceStages([spec()], {
      stages: [{ durationSec: 30, targetVus: 4 }],
      execute,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 300);
    const report = await promise;
    // 30 s planifiées, arrêtées après ~300 ms : bien moins d'exécutions.
    expect(report.durationMs).toBeLessThan(10_000);
    expect(report.totalRequests).toBeGreaterThan(0);
  });

  it("reports each stage separately", async () => {
    const execute = fakeExecutor([10]);
    const report = await runPerformanceStages(
      [spec()],
      {
        stages: [
          { durationSec: 1, targetVus: 1 },
          { durationSec: 1, targetVus: 4 },
        ],
        execute,
      },
    );
    expect(report.stages).toHaveLength(2);
    // Le stage à 4 VUs fait plus d'exécutions que celui à 1 VU (latence constante).
    expect(report.stages[1].requests).toBeGreaterThan(report.stages[0].requests);
    expect(report.peakVus).toBe(4);
  });
});

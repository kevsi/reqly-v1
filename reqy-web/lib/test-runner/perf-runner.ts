/**
 * Moteur de charge par stages (VUs × durée).
 *
 * Chaque stage lance `targetVus` workers qui rejouent la liste de requêtes
 * en boucle jusqu'à la fin de la durée du stage. Les latences et les
 * assertions sont agrégées par requête ; le rapport final expose les
 * percentiles globaux (p50/p90/p95/p99) et le détail par requête.
 *
 * Différences avec runRequestsConcurrent (mode fonctionnel) : ici on
 * mesure une charge soutenue — le nombre total d'exécutions est variable,
 * on ne consomme pas une liste finie.
 */
import type { Assertion } from "@/lib/test-runner/types";
import type { RequestResponse } from "@/lib/test-runner/types";
import { evaluateAssertions } from "@/lib/test-runner/assertions";
import type { RequestInput } from "@/lib/test-runner/executor";

export interface PerfStage {
  /** Durée du stage en secondes (min 1). */
  durationSec: number;
  /** Utilisateurs virtuels simultanés pour ce stage (min 1). */
  targetVus: number;
}

export interface PerfRequestSpec extends RequestInput {
  id: string;
  name: string;
  assertions?: Assertion[];
}

export interface PerfRequestStats {
  requestId: string;
  name: string;
  count: number;
  errors: number;
  avgMs: number;
  p95Ms: number;
  assertionsPassed: number;
  assertionsFailed: number;
}

export interface PerfStageStats {
  durationSec: number;
  targetVus: number;
  requests: number;
  errors: number;
  avgLatencyMs: number;
}

export interface PerfStagesReport {
  totalRequests: number;
  failedRequests: number;
  /** Durée totale de charge (tous stages) en ms. */
  durationMs: number;
  throughputRps: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  p50Ms: number;
  p90Ms: number;
  p95Ms: number;
  p99Ms: number;
  peakVus: number;
  stages: PerfStageStats[];
  perRequest: PerfRequestStats[];
  assertionSummary: { passed: number; failed: number; total: number };
}

interface LatencyRecord {
  stageIndex: number;
  requestId: string;
  latencyMs: number;
  failed: boolean;
  assertionsPassed: number;
  assertionsFailed: number;
}

const PROGRESS_TICK_REQUESTS = 25;
/**
 * Cap mémoire : au-delà d'un million de mesures (charge extrême ou run
 * très long), on arrête proprement plutôt que d'épuiser le heap desktop.
 */
const MAX_RECORDS = 1_000_000;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function percentileOf(values: number[], p: number): number {
  if (values.length === 0) return 0;
  return percentile([...values].sort((a, b) => a - b), p);
}

export async function runPerformanceStages(
  requests: PerfRequestSpec[],
  options: {
    stages: PerfStage[];
    execute: (req: RequestInput) => Promise<RequestResponse>;
    signal?: AbortSignal;
    /** Total d'exécutions terminées depuis le début du run. */
    onProgress?: (completed: number) => void;
  },
): Promise<PerfStagesReport> {
  const { stages, execute, signal, onProgress } = options;
  const validStages = stages
    .map((s) => ({
      durationSec: Math.max(1, Math.floor(s.durationSec || 1)),
      targetVus: Math.max(1, Math.floor(s.targetVus || 1)),
    }))
    .slice(0, 10);
  if (validStages.length === 0) {
    validStages.push({ durationSec: 10, targetVus: 1 });
  }

  const records: LatencyRecord[] = [];
  let completed = 0;
  let tick = 0;
  const startedAt = Date.now();

  for (let stageIndex = 0; stageIndex < validStages.length; stageIndex++) {
    const stage = validStages[stageIndex];
    if (signal?.aborted) break;
    const stageEnd = Date.now() + stage.durationSec * 1000;

    const worker = async (): Promise<void> => {
      while (Date.now() < stageEnd && !signal?.aborted && records.length < MAX_RECORDS) {
        for (const request of requests) {
          if (Date.now() >= stageEnd || signal?.aborted || records.length >= MAX_RECORDS) break;
          // Les deux branches (try/catch) assignent avant lecture.
          let latencyMs: number;
          let failed: boolean;
          let assertionsPassed = 0;
          let assertionsFailed = 0;
          try {
            const response = await execute({
              method: request.method,
              url: request.url,
              headers: request.headers,
              body: request.body,
            });
            latencyMs = response.responseTimeMs;
            failed = response.statusCode >= 400;
            if (request.assertions?.length) {
              for (const result of evaluateAssertions(request.assertions, response)) {
                if (result.passed) assertionsPassed += 1;
                else assertionsFailed += 1;
              }
            }
          } catch {
            failed = true;
            latencyMs = 0;
          }
          records.push({
            stageIndex,
            requestId: request.id,
            latencyMs,
            failed,
            assertionsPassed,
            assertionsFailed,
          });
          completed += 1;
          // Le tick par exécution coûterait un re-rendu React par requête
          // en charge : on space les callbacks.
          if (++tick % PROGRESS_TICK_REQUESTS === 0) onProgress?.(completed);
        }
      }
    };

    const workers: Array<Promise<void>> = [];
    for (let i = 0; i < stage.targetVus; i++) workers.push(worker());
    await Promise.all(workers);
  }

  const durationMs = Math.max(1, Date.now() - startedAt);
  const latencies = records.map((r) => r.latencyMs);
  const sorted = [...latencies].sort((a, b) => a - b);
  const failedRequests = records.filter((r) => r.failed).length;

  const byRequest = new Map<string, LatencyRecord[]>();
  for (const record of records) {
    const list = byRequest.get(record.requestId);
    if (list) list.push(record);
    else byRequest.set(record.requestId, [record]);
  }

  const perRequest: PerfRequestStats[] = requests.map((request) => {
    const list = byRequest.get(request.id) ?? [];
    const latenciesForRequest = list.map((r) => r.latencyMs);
    const assertionsPassed = list.reduce((sum, r) => sum + r.assertionsPassed, 0);
    const assertionsFailed = list.reduce((sum, r) => sum + r.assertionsFailed, 0);
    return {
      requestId: request.id,
      name: request.name,
      count: list.length,
      errors: list.filter((r) => r.failed).length,
      avgMs: latenciesForRequest.length
        ? Math.round(latenciesForRequest.reduce((a, b) => a + b, 0) / latenciesForRequest.length)
        : 0,
      p95Ms: Math.round(percentileOf(latenciesForRequest, 95)),
      assertionsPassed,
      assertionsFailed,
    };
  });

  // Stats par stage : groupées par l'index du stage au moment de la mesure.
  const stageStats: PerfStageStats[] = validStages.map((stage, stageIndex) => {
    const slice = records.filter((r) => r.stageIndex === stageIndex);
    const latenciesForStage = slice.map((r) => r.latencyMs);
    return {
      durationSec: stage.durationSec,
      targetVus: stage.targetVus,
      requests: slice.length,
      errors: slice.filter((r) => r.failed).length,
      avgLatencyMs: latenciesForStage.length
        ? Math.round(latenciesForStage.reduce((a, b) => a + b, 0) / latenciesForStage.length)
        : 0,
    };
  });

  return {
    totalRequests: records.length,
    failedRequests,
    durationMs,
    throughputRps: Number(((records.length / durationMs) * 1000).toFixed(1)),
    avgMs: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0,
    minMs: sorted.length ? sorted[0] : 0,
    maxMs: sorted.length ? sorted[sorted.length - 1] : 0,
    p50Ms: Math.round(percentile(sorted, 50)),
    p90Ms: Math.round(percentile(sorted, 90)),
    p95Ms: Math.round(percentile(sorted, 95)),
    p99Ms: Math.round(percentile(sorted, 99)),
    peakVus: Math.max(...validStages.map((s) => s.targetVus)),
    stages: stageStats,
    perRequest,
    assertionSummary: {
      passed: perRequest.reduce((s, r) => s + r.assertionsPassed, 0),
      failed: perRequest.reduce((s, r) => s + r.assertionsFailed, 0),
      total: perRequest.reduce((s, r) => s + r.assertionsPassed + r.assertionsFailed, 0),
    },
  };
}

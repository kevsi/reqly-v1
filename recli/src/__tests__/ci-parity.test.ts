/**
 * ci-parity.test.ts — Task 10 (P1.3) CI parity guard.
 *
 * Locks in the contract the GitHub Action depends on:
 *   1. `runCollection` marks a request whose assertion fails as `passed === false`.
 *   2. `buildJUnit(results)` emits a JUnit `<failure>` element for that failing request,
 *      and the `<testsuite>` header reports tests/failures counts.
 *   3. A request that errors (e.g. network failure) is also surfaced as a `<failure>`
 *      (typed `RequestError`), so CI consumers can detect it.
 *
 * External HTTP is mocked so this test never hits the network.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runCollection } from "../runner.js";
import { buildJUnit } from "../reporters.js";
import type { ExportBundle } from "../types.js";

/** Minimal fetch Response double — avoids relying on the global Response. */
function makeMockResponse(
  status: number,
  body: string,
  headers: Record<string, string> = {},
): unknown {
  const headerMap = new Map(Object.entries(headers));
  return {
    status,
    statusText: status < 400 ? "OK" : "Error",
    headers: {
      forEach: (cb: (value: string, key: string) => void) =>
        headerMap.forEach((value, key) => cb(value, key)),
      get: (key: string) => headerMap.get(key.toLowerCase()) ?? null,
    },
    async text(): Promise<string> {
      return body;
    },
    async arrayBuffer(): Promise<ArrayBuffer> {
      return new TextEncoder().encode(body).buffer;
    },
  };
}

function makeFailingBundle(): ExportBundle {
  return {
    version: "1.0",
    collections: [
      {
        name: "CI Parity Collection",
        requests: [
          {
            name: "status should be 404 but is 200",
            method: "GET",
            url: "https://example.test/api/health",
            assert: [{ expr: "status == 404" }],
          },
        ],
      },
    ],
  };
}

describe("ci-parity: recli runCollection + JUnit", () => {
  beforeEach(() => {
    // Mock external HTTP so no network is hit during the CI parity check.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        makeMockResponse(200, JSON.stringify({ ok: true }), {
          "content-type": "application/json",
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("marks a request with a failing assertion as failed and emits a JUnit <failure>", async () => {
    const results = await runCollection(makeFailingBundle(), { timeoutMs: 5000 });

    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
    expect(results[0].assertions?.some((a) => !a.passed)).toBe(true);

    const junit = buildJUnit(results);
    expect(junit).toContain("<failure");
    expect(junit).toContain('tests="1"');
    expect(junit).toContain('failures="1"');
  });

  it('emits a <failure type="RequestError"> when the request errors (e.g. network)', async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("getaddrinfo ENOTFOUND example.test");
      }),
    );

    const results = await runCollection(makeFailingBundle(), { timeoutMs: 5000 });
    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
    expect(results[0].error).toBeDefined();

    const junit = buildJUnit(results);
    expect(junit).toContain("<failure");
    expect(junit).toContain('type="RequestError"');
  });
});

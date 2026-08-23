import { describe, it, expect, vi } from "vitest";

const mockCreateContext = vi.fn((sandbox) => sandbox);

vi.mock("node:vm", () => ({
  Script: class {
    constructor(code: string) {
      this.code = code;
    }
    runInContext(ctx: unknown, _options?: unknown) {
      const fn = new Function(
        "pm",
        "console",
        "Math",
        "Date",
        "JSON",
        "Array",
        "Object",
        "String",
        "Number",
        "Boolean",
        "RegExp",
        "Map",
        "Set",
        "URL",
        "parseInt",
        "parseFloat",
        "isNaN",
        "isFinite",
        "encodeURIComponent",
        "decodeURIComponent",
        this.code,
      );
      return fn(
        ctx.pm,
        ctx.console,
        ctx.Math,
        ctx.Date,
        ctx.JSON,
        ctx.Array,
        ctx.Object,
        ctx.String,
        ctx.Number,
        ctx.Boolean,
        ctx.RegExp,
        ctx.Map,
        ctx.Set,
        ctx.URL,
        ctx.parseInt,
        ctx.parseFloat,
        ctx.isNaN,
        ctx.isFinite,
        ctx.encodeURIComponent,
        ctx.decodeURIComponent,
      );
    }
  },
  createContext: (...args: unknown[]) => mockCreateContext(...args),
}));

import {
  buildIterationContexts,
  moveItemInArray,
  moveItemById,
  runCollection,
} from "@/lib/test-runner/runner";
import { resolveSelectedCollectionId } from "@/lib/runner-state";
import type { RequestItem, Collection } from "@/hooks/request-types";
import type { RequestResponse } from "@/lib/test-runner/types";

const fakeFetch = vi.fn().mockResolvedValue({
  statusCode: 200,
  body: { ok: true },
  headers: { "content-type": "application/json" },
  responseTimeMs: 50,
});

const request: RequestItem = {
  id: "r1",
  name: "GET /ping",
  method: "GET",
  url: "https://api.example.com/ping",
  headers: [],
  queryParams: [],
  bodyType: "none",
  authType: "none",
  runnerAssertions: [{ type: "status", expected: 200 }],
} as unknown as RequestItem;

const collection: Collection = {
  id: "c1",
  name: "Smoke",
  workspaceId: "ws",
  requests: [request],
  folders: [],
  createdAt: 0,
  updatedAt: 0,
};

describe("runCollection", () => {
  it("runs all requests sequentially and aggregates results", async () => {
    fakeFetch.mockClear();
    const report = await runCollection(
      collection,
      {
        environment: {},
        iterationData: {},
        iterationIndex: 0,
        log: () => {},
      },
      { executor: fakeFetch },
    );

    expect(report.summary.total).toBe(1);
    expect(report.summary.passed).toBe(1);
    expect(report.results[0].status).toBe("pass");
    expect(fakeFetch).toHaveBeenCalledOnce();
  });

  it("calls executor with the request URL and method", async () => {
    fakeFetch.mockClear();
    await runCollection(
      collection,
      { environment: {}, iterationData: {}, iterationIndex: 0, log: () => {} },
      { executor: fakeFetch },
    );
    expect(fakeFetch).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET", url: expect.stringContaining("/ping") }),
    );
  });

  it("marks request failed when assertions fail", async () => {
    fakeFetch.mockClear();
    const failingFetch = vi.fn().mockResolvedValue({
      statusCode: 500,
      body: {},
      headers: {},
      responseTimeMs: 50,
    } as RequestResponse);
    const report = await runCollection(
      {
        ...collection,
        requests: [{ ...request, runnerAssertions: [{ type: "status", expected: 200 }] }],
      },
      { environment: {}, iterationData: {}, iterationIndex: 0, log: () => {} },
      { executor: failingFetch },
    );
    expect(report.results[0].status).toBe("fail");
    expect(report.summary.failed).toBe(1);
  });

  it("marks request errored when executor throws", async () => {
    fakeFetch.mockClear();
    const throwingFetch = vi.fn().mockRejectedValue(new Error("network"));
    const report = await runCollection(
      collection,
      { environment: {}, iterationData: {}, iterationIndex: 0, log: () => {} },
      { executor: throwingFetch },
    );
    expect(report.results[0].status).toBe("errored");
    expect(report.results[0].error).toContain("network");
  });

  it("runs dataset iterations when provided", async () => {
    fakeFetch.mockClear();
    const ctx = [
      { environment: {}, iterationData: { userId: "1" }, iterationIndex: 0, log: () => {} },
      { environment: {}, iterationData: { userId: "2" }, iterationIndex: 1, log: () => {} },
    ];
    const report = await runCollection(
      collection,
      { environment: {}, iterationData: {}, iterationIndex: 0, log: () => {} },
      { executor: fakeFetch, iterations: ctx },
    );
    expect(report.results.length).toBe(2);
    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });

  it("builds iteration contexts from the configured repetition count even without dataset", () => {
    const contexts = buildIterationContexts(
      { environment: {}, iterationData: {}, iterationIndex: 0, log: () => {} },
      [],
      3,
    );

    expect(contexts).toHaveLength(3);
    expect(contexts.map((ctx) => ctx.iterationIndex)).toEqual([0, 1, 2]);
    expect(contexts[2].iterationData.iteration).toBe("3");
  });

  it("reorders request items without losing the dragged element", () => {
    const list = ["A", "B", "C", "D"];

    expect(moveItemInArray(list, 0, 2)).toEqual(["B", "C", "A", "D"]);
    expect(moveItemInArray(list, 3, 1)).toEqual(["A", "D", "B", "C"]);
    expect(moveItemInArray(list, 1, 1)).toEqual(list);
  });

  it("reorders by stable request id instead of stale dragged index", () => {
    const list = [
      { id: "A", label: "Alpha" },
      { id: "B", label: "Bravo" },
      { id: "C", label: "Charlie" },
      { id: "D", label: "Delta" },
    ];

    expect(moveItemById(list, "A", "C")).toEqual([
      { id: "B", label: "Bravo" },
      { id: "C", label: "Charlie" },
      { id: "A", label: "Alpha" },
      { id: "D", label: "Delta" },
    ]);

    expect(moveItemById(list, "D", "B")).toEqual([
      { id: "A", label: "Alpha" },
      { id: "D", label: "Delta" },
      { id: "B", label: "Bravo" },
      { id: "C", label: "Charlie" },
    ]);
  });

  it("falls back to the first collection when the selected id is empty or stale", () => {
    const collections = [
      { id: "c1", name: "Alpha" },
      { id: "c2", name: "Beta" },
    ] as Collection[];

    expect(resolveSelectedCollectionId(collections, "")).toBe("c1");
    expect(resolveSelectedCollectionId(collections, "missing")).toBe("c1");
    expect(resolveSelectedCollectionId(collections, "c2")).toBe("c2");
    expect(resolveSelectedCollectionId([], "c1")).toBe("");
  });

  it("interpolates {{var}} in URL from environment", async () => {
    fakeFetch.mockClear();
    const reqWithVar: RequestItem = {
      ...request,
      id: "r2",
      name: "GET /v2/users/{{userId}}",
      url: "https://api.example.com/v2/users/{{userId}}",
      assertions: [],
    } as unknown as RequestItem;
    const coll: Collection = { ...collection, requests: [reqWithVar] };
    await runCollection(
      coll,
      {
        environment: { userId: "42" },
        iterationData: {},
        iterationIndex: 0,
        log: () => {},
      },
      { executor: fakeFetch },
    );
    expect(fakeFetch).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://api.example.com/v2/users/42" }),
    );
  });

  it("runs pre-request script before HTTP and post-response after", async () => {
    fakeFetch.mockClear();
    const preExecuted: string[] = [];
    const reqWithScripts: RequestItem = {
      ...request,
      id: "r3",
      name: "Scripted request",
      preRequestScript: "pm.environment.set('preRan', 'yes')",
      postResponseScript: "pm.environment.set('postRan', 'yes')",
    } as unknown as RequestItem;
    const ctx = {
      environment: {} as Record<string, string>,
      iterationData: {},
      iterationIndex: 0,
      log: (_m: string) => {},
    };
    const localExecutor = vi.fn(async (r: unknown) => {
      preExecuted.push((r as { url: string }).url);
      return { statusCode: 200, body: {}, headers: {}, responseTimeMs: 10 };
    });
    await runCollection({ ...collection, requests: [reqWithScripts] }, ctx, {
      executor: localExecutor,
    });
    expect(ctx.environment.preRan).toBe("yes");
    expect(ctx.environment.postRan).toBe("yes");
    expect(preExecuted.length).toBe(1);
  });

  it("stops execution on failure when stopOnFailure is true", async () => {
    const req1: RequestItem = {
      ...request,
      id: "r1",
      name: "r1",
      runnerAssertions: [{ type: "status", expected: 500 }],
    } as unknown as RequestItem;
    const req2: RequestItem = { ...request, id: "r2", name: "r2" } as unknown as RequestItem;
    const multiColl: Collection = { ...collection, requests: [req1, req2] };

    const localExecutor = vi
      .fn()
      .mockResolvedValue({ statusCode: 200, body: {}, headers: {}, responseTimeMs: 10 });
    const report = await runCollection(
      multiColl,
      { environment: {}, iterationData: {}, iterationIndex: 0, log: () => {} },
      { executor: localExecutor, stopOnFailure: true },
    );

    expect(report.results.length).toBe(1);
    expect(report.results[0].requestId).toBe("r1");
  });

  it("triggers onRequestDone callback for each completed request", async () => {
    const progressCalls: number[] = [];
    const localExecutor = vi
      .fn()
      .mockResolvedValue({ statusCode: 200, body: {}, headers: {}, responseTimeMs: 10 });
    await runCollection(
      collection,
      { environment: {}, iterationData: {}, iterationIndex: 0, log: () => {} },
      {
        executor: localExecutor,
        onRequestDone: (completed, total) => progressCalls.push(completed / total),
      },
    );
    expect(progressCalls).toEqual([1]);
  });
});

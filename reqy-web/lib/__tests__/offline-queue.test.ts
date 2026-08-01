import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Tauri bridge so we exercise queue.ts in isolation (no real IPC).
const { enqueueMock, listPendingMock, markSentMock } = vi.hoisted(() => ({
  enqueueMock: vi.fn(),
  listPendingMock: vi.fn(),
  markSentMock: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  enqueueRequest: enqueueMock,
  listPending: listPendingMock,
  markSent: markSentMock,
  isTauriAvailable: () => true,
}));

import {
  classifyError,
  enqueueOnNetworkFailure,
  replayPending,
  type QueuedRequest,
} from "@/lib/offline/queue";

const samplePending = (id: string, over: Partial<QueuedRequest> = {}): QueuedRequest => ({
  id,
  method: "GET",
  url: `https://api.example.com/${id}`,
  headers: [["Accept", "application/json"]],
  body: undefined,
  createdAt: 1_700_000_000_000,
  reason: "network",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("classifyError", () => {
  it("classifies a fetch-failed TypeError as network", () => {
    expect(classifyError(new TypeError("fetch failed"))).toBe("network");
  });

  it("classifies an error carrying status 404 as application", () => {
    const err = Object.assign(new Error("Not Found"), { status: 404 });
    expect(classifyError(err)).toBe("application");
  });

  it("classifies a timeout (AbortError) as network", () => {
    const err = Object.assign(new Error("Timeout"), { name: "AbortError" });
    expect(classifyError(err)).toBe("network");
  });

  it("classifies a connection-refused message as network", () => {
    expect(classifyError(new Error("connect ECONNREFUSED 127.0.0.1:3000"))).toBe("network");
  });

  it("classifies a 2xx status error as unknown (not a failure class)", () => {
    const err = Object.assign(new Error("ok"), { status: 200 });
    expect(classifyError(err)).toBe("unknown");
  });
});

describe("enqueueOnNetworkFailure", () => {
  it("enqueues on a network failure, converting headers/body to the store shape", async () => {
    await enqueueOnNetworkFailure(
      {
        method: "POST",
        url: "https://api.example.com/v1",
        headers: { "Content-Type": "application/json" },
        body: '{"a":1}',
      },
      { error: new TypeError("fetch failed") },
    );

    expect(enqueueMock).toHaveBeenCalledTimes(1);
    const arg = enqueueMock.mock.calls[0][0] as QueuedRequest;
    expect(arg.method).toBe("POST");
    expect(arg.url).toBe("https://api.example.com/v1");
    expect(arg.headers).toEqual([["Content-Type", "application/json"]]);
    expect(arg.body).toEqual(Array.from(new TextEncoder().encode('{"a":1}')));
    expect(arg.reason).toBe("network");
    expect(typeof arg.id).toBe("string");
    expect(typeof arg.createdAt).toBe("number");
  });

  it("does NOT enqueue on an application error (status 404)", async () => {
    enqueueMock.mockReset();
    await enqueueOnNetworkFailure(
      { method: "GET", url: "https://api.example.com/missing", headers: {} },
      { error: Object.assign(new Error("Not Found"), { status: 404 }) },
    );
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("respects an explicit classification flag (network -> enqueue)", async () => {
    enqueueMock.mockReset();
    await enqueueOnNetworkFailure(
      { method: "GET", url: "https://api.example.com/x", headers: {} },
      { classification: "network" },
    );
    expect(enqueueMock).toHaveBeenCalledTimes(1);
  });

  it("respects an explicit classification flag (application -> skip)", async () => {
    enqueueMock.mockReset();
    await enqueueOnNetworkFailure(
      { method: "GET", url: "https://api.example.com/x", headers: {} },
      { classification: "application" },
    );
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});

describe("replayPending", () => {
  it("replays each pending item, marks sent on success, and returns counts", async () => {
    listPendingMock.mockResolvedValue([samplePending("a"), samplePending("b")]);
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false });
    const onReplayed = vi.fn();

    const res = await replayPending({ execute, onReplayed });

    expect(res).toEqual({ replayed: 2, succeeded: 1 });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(markSentMock).toHaveBeenCalledWith("a");
    expect(markSentMock).not.toHaveBeenCalledWith("b");
    expect(onReplayed).toHaveBeenCalledWith("a", true);
    expect(onReplayed).toHaveBeenCalledWith("b", false);
  });

  it("treats a thrown execute as a failure (not marked sent)", async () => {
    listPendingMock.mockResolvedValue([samplePending("c")]);
    const execute = vi.fn().mockRejectedValue(new Error("still down"));

    const res = await replayPending({ execute });

    expect(res).toEqual({ replayed: 1, succeeded: 0 });
    expect(markSentMock).not.toHaveBeenCalledWith("c");
  });

  it("returns zeros for an empty queue", async () => {
    listPendingMock.mockResolvedValue([]);
    const res = await replayPending({ execute: vi.fn() });
    expect(res).toEqual({ replayed: 0, succeeded: 0 });
  });
});

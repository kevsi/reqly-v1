import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSSE } from "@/hooks/use-sse";

function createMockReadableStream(chunks: string[]) {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]));
        index++;
      } else {
        controller.close();
      }
    },
  });
}

function createControllableStream() {
  let ctrl: ReadableStreamDefaultController<Uint8Array> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c;
    },
  });
  const encoder = new TextEncoder();
  return {
    stream,
    enqueue: (text: string) => ctrl!.enqueue(encoder.encode(text)),
    close: () => ctrl!.close(),
  };
}

function mockResponse(chunks: string[], overrides?: Partial<Response>) {
  const stream = createMockReadableStream(chunks);
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    body: stream,
    ...overrides,
  } as unknown as Response;
}

describe("useSSE hook", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  it("initializes with default idle state", () => {
    const { result } = renderHook(() => useSSE());

    expect(result.current.status).toBe("idle");
    expect(result.current.events).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.statusMessage).toBeNull();
    expect(result.current.totalBytes).toBe(0);
    expect(result.current.eventsPerSec).toBe(0);
    expect(result.current.isPaused).toBe(false);
    expect(result.current.reconnectCount).toBe(0);
  });

  it("connects, parses incoming SSE events and auto-reconnects on close", async () => {
    const sseChunk = 'event: custom\nid: evt-123\ndata: {"status":"ok"}\n\n';
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse([sseChunk]));
    globalThis.fetch = fetchSpy;

    const { result } = renderHook(() => useSSE());

    await act(async () => {
      result.current.connect({
        url: "http://localhost:3000/api/sse",
      });
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:3000/api/sse",
      expect.objectContaining({
        method: "GET",
      }),
    );

    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0]).toMatchObject({
      id: "evt-123",
      event: "custom",
      data: '{"status":"ok"}',
    });

    // The stream ended: a reconnection is scheduled (EventSource-like).
    expect(result.current.status).toBe("connecting");
    expect(result.current.reconnectCount).toBe(1);
    expect(result.current.statusMessage).toMatch(/Reconnexion automatique/);

    act(() => {
      result.current.disconnect();
    });
  });

  it("resumes with lastEventId on the reconnection attempt", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(["id: evt-1\ndata: one\n\n"]))
      .mockResolvedValueOnce(mockResponse(["data: two\n\n"]));
    globalThis.fetch = fetchSpy;

    const { result } = renderHook(() => useSSE());

    await act(async () => {
      result.current.connect({ url: "http://localhost:3000/api/sse" });
    });
    expect(result.current.events).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const secondCallUrl = fetchSpy.mock.calls[1][0];
    expect(secondCallUrl).toBe("http://localhost:3000/api/sse?lastEventId=evt-1");
    expect(result.current.events).toHaveLength(2);
    expect(result.current.events[1].data).toBe("two");

    act(() => {
      result.current.disconnect();
    });
  });

  it("supports POST method with request body and custom headers", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(["data: hello post\n\n"]));
    globalThis.fetch = fetchSpy;

    const { result } = renderHook(() => useSSE());

    await act(async () => {
      result.current.connect({
        url: "http://localhost:3000/api/sse-post",
        method: "POST",
        body: '{"stream":true}',
        headers: [{ key: "X-Test", value: "123", enabled: true }],
        auth: { type: "bearer", token: "secret-token" },
      });
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:3000/api/sse-post",
      expect.objectContaining({
        method: "POST",
        body: '{"stream":true}',
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-Test": "123",
          Authorization: "Bearer secret-token",
        }),
      }),
    );

    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0].data).toBe("hello post");

    act(() => {
      result.current.disconnect();
    });
  });

  it("handles CRLF line endings", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(mockResponse(["data: hello\r\nevent: ping\r\n\r\n"]));
    globalThis.fetch = fetchSpy;

    const { result } = renderHook(() => useSSE());

    await act(async () => {
      result.current.connect({ url: "http://localhost:3000/api/sse" });
    });

    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0]).toMatchObject({
      event: "ping",
      data: "hello",
    });

    act(() => {
      result.current.disconnect();
    });
  });

  it("flushes a pending event when the stream ends without a trailing blank line", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(["data: final"]));
    globalThis.fetch = fetchSpy;

    const { result } = renderHook(() => useSSE());

    await act(async () => {
      result.current.connect({ url: "http://localhost:3000/api/sse" });
    });

    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0].data).toBe("final");

    act(() => {
      result.current.disconnect();
    });
  });

  it("applies the event filter", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(mockResponse(["event: a\ndata: 1\n\nevent: ping\ndata: 2\n\n"]));
    globalThis.fetch = fetchSpy;

    const { result } = renderHook(() => useSSE());

    await act(async () => {
      result.current.connect({ url: "http://localhost:3000/api/sse", eventFilter: "ping" });
    });

    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0]).toMatchObject({ event: "ping", data: "2" });

    act(() => {
      result.current.disconnect();
    });
  });

  it("trims events to maxEvents", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(["data: 1\n\ndata: 2\n\ndata: 3\n\n"]));
    globalThis.fetch = fetchSpy;

    const { result } = renderHook(() => useSSE());

    await act(async () => {
      result.current.connect({ url: "http://localhost:3000/api/sse", maxEvents: 2 });
    });

    expect(result.current.events).toHaveLength(2);
    expect(result.current.events.map((e) => e.data)).toEqual(["2", "3"]);

    act(() => {
      result.current.disconnect();
    });
  });

  it("surfaces HTTP errors immediately without retrying", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(mockResponse([], { ok: false, status: 401, statusText: "Unauthorized" }));
    globalThis.fetch = fetchSpy;

    const { result } = renderHook(() => useSSE());

    await act(async () => {
      result.current.connect({ url: "http://localhost:3000/api/sse" });
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("Connexion SSE refusée par le serveur (401 Unauthorized)");
    expect(result.current.reconnectCount).toBe(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("surfaces network errors immediately when autoReconnect is disabled", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error("Network Error"));
    globalThis.fetch = fetchSpy;

    const { result } = renderHook(() => useSSE());

    await act(async () => {
      result.current.connect({ url: "http://invalid-host/sse", autoReconnect: false });
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("Impossible de se connecter au flux SSE : Network Error");
    expect(result.current.reconnectCount).toBe(0);
  });

  it("gives up after maxReconnects attempts with a clear message", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error("Network Error"));
    globalThis.fetch = fetchSpy;

    const { result } = renderHook(() => useSSE());

    await act(async () => {
      result.current.connect({ url: "http://invalid-host/sse", maxReconnects: 3 });
    });

    expect(result.current.status).toBe("connecting");
    expect(result.current.reconnectCount).toBe(1);

    // Advance well past every backoff step (up to 20 s per attempt).
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(25_000);
      });
    }

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe(
      "La connexion a été perdue après 3 tentatives de reconnexion.",
    );
    expect(result.current.reconnectCount).toBe(3);
  });

  it("honors the server retry: hint for the backoff base", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(["retry: 500\ndata: x\n\n"]))
      .mockResolvedValueOnce(mockResponse(["data: y\n\n"]));
    globalThis.fetch = fetchSpy;

    const { result } = renderHook(() => useSSE());

    await act(async () => {
      result.current.connect({ url: "http://localhost:3000/api/sse" });
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Jittered delay: 500ms base => between 375 and 625 ms.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    act(() => {
      result.current.disconnect();
    });
  });

  it("cancels a pending reconnection on disconnect", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(["data: one\n\n"]));
    globalThis.fetch = fetchSpy;

    const { result } = renderHook(() => useSSE());

    await act(async () => {
      result.current.connect({ url: "http://localhost:3000/api/sse" });
    });
    expect(result.current.status).toBe("connecting");

    act(() => {
      result.current.disconnect();
    });
    expect(result.current.status).toBe("closed");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("resets lastEventId when connecting to a different URL", async () => {
    const fetchSpy = vi
      .fn()
      .mockImplementation(() => Promise.resolve(mockResponse(["id: a1\ndata: x\n\n"])));
    globalThis.fetch = fetchSpy;

    const { result } = renderHook(() => useSSE());

    await act(async () => {
      result.current.connect({ url: "http://localhost:3000/api/stream-a" });
    });
    act(() => {
      result.current.disconnect();
    });

    await act(async () => {
      result.current.connect({ url: "http://localhost:3000/api/stream-b" });
    });
    const secondCallUrl = fetchSpy.mock.calls[1][0];
    expect(secondCallUrl).toBe("http://localhost:3000/api/stream-b");
    act(() => {
      result.current.disconnect();
    });

    await act(async () => {
      result.current.connect({ url: "http://localhost:3000/api/stream-a" });
    });
    const thirdCallUrl = fetchSpy.mock.calls[2][0];
    expect(thirdCallUrl).toBe("http://localhost:3000/api/stream-a?lastEventId=a1");
    act(() => {
      result.current.disconnect();
    });
  });

  it("pauses and resumes mid-stream without stale closure", async () => {
    const { stream, enqueue, close } = createControllableStream();
    const fetchSpy = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        body: stream,
      } as unknown as Response);
    globalThis.fetch = fetchSpy;

    const { result } = renderHook(() => useSSE());

    await act(async () => {
      result.current.connect({ url: "http://localhost:3000/api/sse" });
    });
    expect(result.current.status).toBe("open");

    // Pause, then let the server push an event.
    await act(async () => {
      result.current.togglePause();
    });
    expect(result.current.isPaused).toBe(true);

    await act(async () => {
      enqueue("data: while paused\n\n");
      close();
    });
    expect(result.current.events).toHaveLength(0);

    // Resume: a fresh stream delivers events again.
    act(() => {
      result.current.disconnect();
    });
    const { stream: stream2, enqueue: enqueue2, close: close2 } = createControllableStream();
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      body: stream2,
    } as unknown as Response);

    await act(async () => {
      result.current.togglePause();
      result.current.connect({ url: "http://localhost:3000/api/sse" });
    });
    await act(async () => {
      enqueue2("data: after resume\n\n");
      close2();
    });
    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0].data).toBe("after resume");

    act(() => {
      result.current.disconnect();
    });
  });

  it("tracks stats and clears them with clearEvents", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(["data: hello\n\n"]));
    globalThis.fetch = fetchSpy;

    const { result } = renderHook(() => useSSE());

    await act(async () => {
      result.current.connect({ url: "http://localhost:3000/api/sse" });
    });

    expect(result.current.totalBytes).toBe(5);
    expect(result.current.eventsPerSec).toBeGreaterThan(0);

    act(() => {
      result.current.clearEvents();
    });
    expect(result.current.events).toEqual([]);
    expect(result.current.totalBytes).toBe(0);
    expect(result.current.eventsPerSec).toBe(0);

    act(() => {
      result.current.disconnect();
    });
  });
});

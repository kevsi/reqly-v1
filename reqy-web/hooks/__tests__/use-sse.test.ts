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

describe("useSSE hook", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("initializes with default idle state", () => {
    const { result } = renderHook(() => useSSE());

    expect(result.current.status).toBe("idle");
    expect(result.current.events).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.totalBytes).toBe(0);
    expect(result.current.eventsPerSec).toBe(0);
    expect(result.current.isPaused).toBe(false);
    expect(result.current.reconnectCount).toBe(0);
  });

  it("connects and parses incoming SSE events via fetch stream", async () => {
    const sseChunk = 'event: custom\nid: evt-123\ndata: {"status":"ok"}\n\n';
    const stream = createMockReadableStream([sseChunk]);

    const mockResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      body: stream,
    } as unknown as Response;

    const fetchSpy = vi.fn().mockResolvedValue(mockResponse);
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

    // Stream finished normally
    expect(result.current.status).toBe("closed");
    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0]).toMatchObject({
      id: "evt-123",
      event: "custom",
      data: '{"status":"ok"}',
    });
  });

  it("supports POST method with request body and custom headers", async () => {
    const sseChunk = "data: hello post\n\n";
    const stream = createMockReadableStream([sseChunk]);

    const mockResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      body: stream,
    } as unknown as Response;

    const fetchSpy = vi.fn().mockResolvedValue(mockResponse);
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
  });

  it("allows toggling pause state and clears events", () => {
    const { result } = renderHook(() => useSSE());

    expect(result.current.isPaused).toBe(false);

    act(() => {
      result.current.togglePause();
    });
    expect(result.current.isPaused).toBe(true);

    act(() => {
      result.current.clearEvents();
    });
    expect(result.current.events).toEqual([]);
    expect(result.current.totalBytes).toBe(0);
  });

  it("handles fetch errors properly", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error("Network Error"));
    globalThis.fetch = fetchSpy;

    const { result } = renderHook(() => useSSE());

    await act(async () => {
      result.current.connect({
        url: "http://invalid-host/sse",
      });
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("Network Error");
  });
});

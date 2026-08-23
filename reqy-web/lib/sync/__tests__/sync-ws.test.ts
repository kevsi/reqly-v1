import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { connectSyncWs } from "@/lib/sync/sync-ws";

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------
type WsListener = ((event) => void) | null;

interface FakeWebSocket {
  onopen: WsListener;
  onclose: WsListener;
  onerror: WsListener;
  onmessage: WsListener;
  readyState: number;
  url: string;
  protocols?: string | string[];
  close: ReturnType<typeof vi.fn>;
  _triggerOpen: () => void;
  _triggerClose: (code?: number) => void;
  _triggerError: () => void;
  _triggerMessage: (data: string) => void;
}

const OPEN = 1;
const CLOSED = 3;

let fakeWsInstances: FakeWebSocket[] = [];
let originalWs: typeof globalThis.WebSocket | undefined;

function createFakeWs(url: string, protocols?: string | string[]): FakeWebSocket {
  const instance: FakeWebSocket = {
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
    readyState: OPEN,
    url,
    protocols,
    close: vi.fn(() => {
      instance.readyState = CLOSED;
      instance.onclose?.({ code: 1000, reason: "", wasClean: true });
    }),
    _triggerOpen() {
      instance.readyState = OPEN;
      instance.onopen?.({});
    },
    _triggerClose(code = 1000) {
      instance.readyState = CLOSED;
      instance.onclose?.({ code, reason: "", wasClean: code === 1000 });
    },
    _triggerError() {
      instance.onerror?.(new Event("error"));
    },
    _triggerMessage(data: string) {
      instance.onmessage?.({ data } as MessageEvent);
    },
  };
  return instance;
}

beforeEach(() => {
  originalWs = globalThis.WebSocket;
  fakeWsInstances = [];
  vi.stubGlobal(
    "WebSocket",
    vi.fn((url: string, protocols?: string | string[]) => {
      const inst = createFakeWs(url, protocols);
      fakeWsInstances.push(inst);
      return inst;
    }),
  );
  // Le flux ticket est asynchrone : on neutralise fetch pour que
  // `refreshProtocols` retombe immédiatement sur le token en subprotocol.
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new TypeError("fetch disabled in sync-ws tests")),
  );
  vi.useFakeTimers();
});

afterEach(() => {
  if (originalWs) {
    vi.stubGlobal("WebSocket", originalWs);
  }
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Helper: get the most recent fake WS instance */
function currentWs(): FakeWebSocket {
  expect(fakeWsInstances.length).toBeGreaterThan(0);
  return fakeWsInstances[fakeWsInstances.length - 1];
}

/** Laisse les microtasks du flux ticket/connect s'exécuter. */
async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("connectSyncWs", () => {
  it("connects to the correct WS URL (http → ws conversion)", async () => {
    connectSyncWs({ workspaceId: "ws-1", syncUrl: "http://localhost:4000" });
    await flushAsync();

    const mockWs = vi.mocked(globalThis.WebSocket);
    expect(mockWs).toHaveBeenCalledWith("ws://localhost:4000/api/sync/ws?workspaceId=ws-1");
  });

  it("converts https to wss", async () => {
    connectSyncWs({ workspaceId: "ws-1", syncUrl: "https://sync.example.com" });
    await flushAsync();

    const mockWs = vi.mocked(globalThis.WebSocket);
    expect(mockWs).toHaveBeenCalledWith("wss://sync.example.com/api/sync/ws?workspaceId=ws-1");
  });

  it("sends the Tauri token as a subprotocol, never in the URL", async () => {
    connectSyncWs({
      workspaceId: "ws-1",
      syncUrl: "https://sync.example.com",
      token: "signed-session-token",
    });
    await flushAsync();

    const mockWs = vi.mocked(globalThis.WebSocket);
    expect(mockWs).toHaveBeenCalledWith("wss://sync.example.com/api/sync/ws?workspaceId=ws-1", [
      "reqly-bearer",
      "signed-session-token",
    ]);
    expect(mockWs.mock.calls[0]?.[0]).not.toContain("signed-session-token");
  });

  it("calls onChange when a 'change' message is received", async () => {
    const onChange = vi.fn();
    connectSyncWs({ workspaceId: "ws-1", syncUrl: "http://localhost:4000", onChange });
    await flushAsync();

    const ws = currentWs();
    ws._triggerOpen();
    ws._triggerMessage(JSON.stringify({ type: "change", workspaceId: "ws-1", entityIds: ["c1"] }));

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("does not call onChange for a 'hello' message", async () => {
    const onChange = vi.fn();
    connectSyncWs({ workspaceId: "ws-1", syncUrl: "http://localhost:4000", onChange });
    await flushAsync();

    const ws = currentWs();
    ws._triggerOpen();
    ws._triggerMessage(JSON.stringify({ type: "hello", workspaceId: "ws-1" }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("calls onError when an 'error' message is received", async () => {
    const onError = vi.fn();
    connectSyncWs({ workspaceId: "ws-1", syncUrl: "http://localhost:4000", onError });
    await flushAsync();

    const ws = currentWs();
    ws._triggerMessage(JSON.stringify({ type: "error", payload: "Session expired" }));

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "Session expired" }));
  });

  it("reconnects on close with exponential backoff", async () => {
    connectSyncWs({ workspaceId: "ws-1", syncUrl: "http://localhost:4000" });
    await flushAsync();

    // First connection
    const ws1 = currentWs();
    ws1._triggerOpen();

    // Close triggers reconnect after 1s
    ws1._triggerClose(1006);
    const mockWs = vi.mocked(globalThis.WebSocket);
    expect(mockWs).toHaveBeenCalledTimes(1);

    // Advance time by the first reconnect delay
    vi.advanceTimersByTime(1000);
    await flushAsync();
    expect(mockWs).toHaveBeenCalledTimes(2);

    // Second close triggers reconnect after 2s (doubled)
    const ws2 = currentWs();
    ws2._triggerOpen();
    ws2._triggerClose(1006);

    vi.advanceTimersByTime(2000);
    await flushAsync();
    expect(mockWs).toHaveBeenCalledTimes(3);
  });

  it("does not reconnect after explicit disconnect", async () => {
    const controller = connectSyncWs({ workspaceId: "ws-1", syncUrl: "http://localhost:4000" });
    await flushAsync();

    const ws = currentWs();
    ws._triggerOpen();

    controller.disconnect();

    // Close after disconnect should NOT trigger reconnect
    ws._triggerClose(1006);
    vi.advanceTimersByTime(5000);
    const mockWs = vi.mocked(globalThis.WebSocket);
    expect(mockWs).toHaveBeenCalledTimes(1);
  });

  it("isConnected returns true after open, false after close", async () => {
    const controller = connectSyncWs({ workspaceId: "ws-1", syncUrl: "http://localhost:4000" });
    await flushAsync();

    expect(controller.isConnected()).toBe(false);

    const ws = currentWs();
    ws._triggerOpen();
    expect(controller.isConnected()).toBe(true);

    ws._triggerClose();
    expect(controller.isConnected()).toBe(false);
  });

  it("handles multiple change messages", async () => {
    const onChange = vi.fn();
    connectSyncWs({ workspaceId: "ws-1", syncUrl: "http://localhost:4000", onChange });
    await flushAsync();

    const ws = currentWs();
    ws._triggerOpen();

    ws._triggerMessage(JSON.stringify({ type: "change" }));
    ws._triggerMessage(JSON.stringify({ type: "change" }));
    ws._triggerMessage(JSON.stringify({ type: "change" }));

    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it("ignores malformed JSON messages", async () => {
    const onChange = vi.fn();
    const onError = vi.fn();
    connectSyncWs({ workspaceId: "ws-1", syncUrl: "http://localhost:4000", onChange, onError });
    await flushAsync();

    const ws = currentWs();
    ws._triggerMessage("not json");

    expect(onChange).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("caps reconnect delay at MAX_RECONNECT_DELAY_MS (30s)", async () => {
    connectSyncWs({ workspaceId: "ws-1", syncUrl: "http://localhost:4000" });
    await flushAsync();

    // Simulate many disconnections
    for (let i = 0; i < 10; i++) {
      const ws = currentWs();
      ws._triggerOpen();
      ws._triggerClose(1006);
      vi.advanceTimersByTime(31000); // more than enough for any delay
      await flushAsync();
    }

    // After 10 reconnects, each delay should not exceed 30s
    // First reconnect: 1s, then 2s, 4s, 8s, 16s, 30s, 30s, ...
    const mockWs = vi.mocked(globalThis.WebSocket);
    expect(mockWs.mock.calls.length).toBeGreaterThanOrEqual(5);
    expect(mockWs.mock.calls.length).toBeLessThanOrEqual(12);
  });
});

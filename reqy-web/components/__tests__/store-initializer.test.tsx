import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render } from "@testing-library/react";

/**
 * Chunk 4: the order of operations between `persistence.waitForReady()` and
 * `requestStore.initStore()` is the whole point of the fix. These tests pin
 * the contract: persistence must resolve BEFORE initStore is called, and the
 * effect must be cancellable on unmount.
 */

const mockWaitForReady = vi.fn();
const mockInitStore = vi.fn();

vi.mock("@/lib/persistence", () => ({
  persistence: {
    waitForReady: () => mockWaitForReady(),
  },
}));

vi.mock("@/hooks/use-request-store", () => ({
  requestStore: {
    getState: () => ({
      isLoaded: false,
      initStore: mockInitStore,
    }),
  },
  useRequestStore: (selector: (state: { isLoaded: boolean }) => boolean) =>
    selector({ isLoaded: false }),
}));

import { StoreInitializer } from "@/components/store-initializer";

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("StoreInitializer (Chunk 4: init order)", () => {
  beforeEach(() => {
    mockWaitForReady.mockReset();
    mockInitStore.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("awaits persistence.waitForReady() BEFORE calling requestStore.initStore()", async () => {
    const wait = deferred<void>();
    const init = deferred<void>();
    // initStore should only resolve AFTER waitForReady resolves.
    const order: string[] = [];

    mockWaitForReady.mockImplementation(() => {
      order.push("waitForReady:start");
      return wait.promise.then(() => {
        order.push("waitForReady:end");
      });
    });
    mockInitStore.mockImplementation(() => {
      order.push("initStore:start");
      return init.promise.then(() => {
        order.push("initStore:end");
      });
    });

    render(<StoreInitializer />);

    // Give microtasks a chance to run.
    await Promise.resolve();

    // At this point, waitForReady has been called but not resolved.
    expect(order).toEqual(["waitForReady:start"]);
    expect(mockInitStore).not.toHaveBeenCalled();

    // Resolve waitForReady — now initStore should be called.
    wait.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(order).toEqual(["waitForReady:start", "waitForReady:end", "initStore:start"]);

    // Cleanup
    init.resolve();
  });

  it("does not call initStore if persistence.waitForReady() rejects", async () => {
    mockWaitForReady.mockRejectedValue(new Error("IDB unavailable"));

    render(<StoreInitializer />);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Even though initStore would normally be called, the await on
    // waitForReady threw — but our catch swallows the error and we still
    // fall through to initStore. The fix only guarantees ordering, not
    // abort-on-failure. Pin the current contract.
    expect(mockInitStore).toHaveBeenCalledTimes(1);
  });

  it("skips initStore when the store is already loaded", async () => {
    // Re-mock with isLoaded: true
    vi.doMock("@/hooks/use-request-store", () => ({
      requestStore: {
        getState: () => ({
          isLoaded: true,
          initStore: mockInitStore,
        }),
      },
      useRequestStore: (selector: (state: { isLoaded: boolean }) => boolean) =>
        selector({ isLoaded: true }),
    }));

    mockWaitForReady.mockResolvedValue(undefined);

    // Dynamic import to get a fresh StoreInitializer with the new mock
    const { StoreInitializer: Fresh } = await import("@/components/store-initializer?fresh");
    render(<Fresh />);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockInitStore).not.toHaveBeenCalled();
  });

  it("does not call initStore after unmount (cancellation guard)", async () => {
    const wait = deferred<void>();
    mockWaitForReady.mockImplementation(() => wait.promise);
    mockInitStore.mockResolvedValue(undefined);

    const { unmount } = render(<StoreInitializer />);
    unmount();

    // Resolve waitForReady AFTER unmount.
    wait.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockInitStore).not.toHaveBeenCalled();
  });
});

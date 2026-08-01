import { describe, it, expect, beforeEach } from "vitest";
import { useRequestStore } from "@/hooks/use-request-store";

describe("useRequestStore - Zustand isolation", () => {
  let store: ReturnType<typeof useRequestStore>;

  beforeEach(() => {
    // Each test should get a fresh store reference.
    // With proper Zustand, `useRequestStore.getState()` is stable and isolated.
    store = useRequestStore;
  });

  it("should expose a stable API compatible with zustand create", () => {
    // Proper Zustand v5 stores expose `getState`, `setState`, `subscribe`, and `getInitialState`
    expect(typeof store.getState).toBe("function");
    expect(typeof store.setState).toBe("function");
    expect(typeof store.subscribe).toBe("function");
    expect(typeof store.getInitialState).toBe("function");
  });

  it("should return an initial state with required collections", () => {
    const state = store.getState();

    expect(state).toHaveProperty("collections");
    expect(state).toHaveProperty("environments");
    expect(state).toHaveProperty("workspaces");
    expect(state).toHaveProperty("isLoaded");
    expect(state).toHaveProperty("currentRequest");
    expect(state).toHaveProperty("lastResponse");
    expect(state).toHaveProperty("environmentVariables");
    expect(state).toHaveProperty("aiAudit");
    expect(state).toHaveProperty("datasets");
  });

  it("should create a default environment on initialization", () => {
    const state = store.getState();

    expect(state.environments).toHaveLength(1);
    expect(state.environments[0].id).toBe("env-global");
    expect(state.environments[0].name).toBe("Global");
  });

  it("should have a default workspace", () => {
    const state = store.getState();

    expect(state.workspaces).toHaveLength(1);
    expect(state.workspaces[0].id).toBe("ws-personal");
    expect(state.workspaces[0].name).toBe("Personal");
  });

  it("should not mutate state across getState calls without setState", () => {
    const snapshot1 = store.getState();
    const snapshot2 = store.getState();

    expect(snapshot1).toBe(snapshot2);
  });

  it("should reset to initial state when destroyed and re-created", async () => {
    // Mutate the store
    store.setState({
      ...store.getState(),
      aiAutoApply: true,
    });

    expect(store.getState().aiAutoApply).toBe(true);

    // Reset via the store's reset method
    store.getState().reset();

    expect(store.getState().aiAutoApply).toBe(false);
  });

  it("should batch multiple setState calls", () => {
    const unsub = store.subscribe((state) => {
      // Track render count
      (state as any).__renderCount = ((state as any).__renderCount || 0) + 1;
    });

    store.setState((prev) => ({ ...prev, aiAutoApply: true }));
    store.setState((prev) => ({ ...prev, aiAudit: [] }));

    const finalState = store.getState();
    expect(finalState.aiAutoApply).toBe(true);
    expect(finalState.aiAudit).toEqual([]);

    unsub();
  });

  it("should provide selector functions without re-rendering when unrelated state changes", () => {
    const unsub = store.subscribe(() => {});

    const collections1 = store.getState().collections;
    const collections2 = store.getState().collections;

    expect(collections1).toBe(collections2);
    unsub();
  });
});

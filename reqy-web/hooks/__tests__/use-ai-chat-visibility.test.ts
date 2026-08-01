import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  useAiChatHidden,
  setAiChatHidden,
  AI_CHAT_HIDDEN_KEY,
} from "@/src/ai/hooks/use-ai-chat-visibility";

/**
 * Tests for Chunk 2: replaces the two `setInterval(check, 1000)` pollers
 * that used to live in api-sidebar.tsx and floating-ai-chat.tsx.
 */

describe("useAiChatHidden / setAiChatHidden", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it("defaults to false when nothing is stored", () => {
    const { result } = renderHook(() => useAiChatHidden());
    expect(result.current).toBe(false);
  });

  it("reads 'true' from localStorage on mount", () => {
    localStorage.setItem(AI_CHAT_HIDDEN_KEY, "true");
    const { result } = renderHook(() => useAiChatHidden());
    expect(result.current).toBe(true);
  });

  it("setAiChatHidden(true) writes to localStorage and notifies same-tab subscribers", () => {
    const { result } = renderHook(() => useAiChatHidden());
    expect(result.current).toBe(false);

    act(() => {
      setAiChatHidden(true);
    });

    expect(result.current).toBe(true);
    expect(localStorage.getItem(AI_CHAT_HIDDEN_KEY)).toBe("true");
  });

  it("setAiChatHidden(false) removes the key and notifies same-tab subscribers", () => {
    localStorage.setItem(AI_CHAT_HIDDEN_KEY, "true");
    const { result } = renderHook(() => useAiChatHidden());
    expect(result.current).toBe(true);

    act(() => {
      setAiChatHidden(false);
    });

    expect(result.current).toBe(false);
    expect(localStorage.getItem(AI_CHAT_HIDDEN_KEY)).toBeNull();
  });

  it("does NOT poll — no setInterval is created after mounting", () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    const { unmount } = renderHook(() => useAiChatHidden());
    expect(setIntervalSpy).not.toHaveBeenCalled();
    unmount();
    setIntervalSpy.mockRestore();
  });

  it("reacts to cross-tab storage events", () => {
    const { result } = renderHook(() => useAiChatHidden());
    expect(result.current).toBe(false);

    act(() => {
      localStorage.setItem(AI_CHAT_HIDDEN_KEY, "true");
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: AI_CHAT_HIDDEN_KEY,
          newValue: "true",
        }),
      );
    });

    expect(result.current).toBe(true);
  });

  it("ignores storage events for unrelated keys", () => {
    const { result } = renderHook(() => useAiChatHidden());
    expect(result.current).toBe(false);

    act(() => {
      localStorage.setItem("some-other-key", "true");
      window.dispatchEvent(
        new StorageEvent("storage", { key: "some-other-key", newValue: "true" }),
      );
    });

    expect(result.current).toBe(false);
  });

  it("two concurrent hooks stay in sync via setAiChatHidden", () => {
    const a = renderHook(() => useAiChatHidden());
    const b = renderHook(() => useAiChatHidden());
    expect(a.result.current).toBe(false);
    expect(b.result.current).toBe(false);

    act(() => {
      setAiChatHidden(true);
    });

    expect(a.result.current).toBe(true);
    expect(b.result.current).toBe(true);

    act(() => {
      setAiChatHidden(false);
    });

    expect(a.result.current).toBe(false);
    expect(b.result.current).toBe(false);
  });
});

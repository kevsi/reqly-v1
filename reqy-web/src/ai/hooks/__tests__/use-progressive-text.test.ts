import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProgressiveText } from "@/src/ai/hooks/use-progressive-text";

function setup(initialContent = "") {
  const { result, rerender } = renderHook(
    ({ content }: { content: string }) => useProgressiveText(content, { delayMs: 20 }),
    { initialProps: { content: initialContent } },
  );
  return { result, rerender };
}

function advanceTicks(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("useProgressiveText", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reveals a streamed message word by word until fully displayed", () => {
    const { result, rerender } = setup("");
    rerender({ content: "bonjour le monde" });
    advanceTicks(20);
    expect(result.current).not.toBe("bonjour le monde");
    advanceTicks(5000);
    expect(result.current).toBe("bonjour le monde");
  });

  it("shows a message mounted with full content immediately (history, no retype)", () => {
    const { result } = setup("message complet");
    expect(result.current).toBe("message complet");
    advanceTicks(500);
    expect(result.current).toBe("message complet");
  });

  it("keeps revealing content added after a remount with partial content", () => {
    const { result, rerender } = setup("début de");
    expect(result.current).toBe("début de");
    rerender({ content: "début de réponse" });
    advanceTicks(200);
    expect(result.current).toBe("début de réponse");
  });
});

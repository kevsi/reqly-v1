import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useAiSidebarHistory } from "@/src/ai/hooks/use-ai-sidebar-history";
import { persistence } from "@/lib/persistence";

const HISTORY_KEY = "ai-sidebar-history";

type AnyMsg = Record<string, unknown> & { id: string; role: string; content: string };
type AnySession = Record<string, unknown> & { id: string };

function makeMsg(role: "user" | "assistant", content: string): AnyMsg {
  return { id: Math.random().toString(36).slice(2), role, content };
}

function makeSession(id: string): AnySession {
  return { id, title: id, messages: [makeMsg("user", "hi")] };
}

function stored(): AnySession[] {
  return (persistence.getItem<AnySession[]>(HISTORY_KEY) ?? []) as AnySession[];
}

beforeEach(() => {
  persistence.setItem(HISTORY_KEY, [] as unknown as AnySession[]);
  vi.useFakeTimers();
  if (!(globalThis.crypto && "randomUUID" in globalThis.crypto)) {
    vi.stubGlobal("crypto", { randomUUID: () => "id-" + Math.random().toString(36).slice(2) });
  }
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  cleanup();
});

describe("useAiSidebarHistory — bug #4 (history data loss)", () => {
  it("A: persists session deletion so it does not resurrect on reload", () => {
    persistence.setItem(HISTORY_KEY, [
      makeSession("s1"),
      makeSession("s2"),
    ] as unknown as AnySession[]);
    const { result } = renderHook(({ m }) => useAiSidebarHistory(m as never), {
      initialProps: { m: [] as unknown[] },
    });
    expect(result.current.sessions.length).toBe(2);
    act(() => result.current.handleDeleteSession("s1"));
    expect(stored().map((s) => s.id)).toEqual(["s2"]);
  });

  it("B: keeps the NEWEST sessions when exceeding MAX_HISTORY", () => {
    const seed: AnySession[] = [];
    for (let i = 0; i < 55; i++) seed.push(makeSession("old-" + i));
    persistence.setItem(HISTORY_KEY, seed as unknown as AnySession[]);
    const msgs = [makeMsg("user", "new conv"), makeMsg("assistant", "ok")];
    const { result, rerender } = renderHook(({ m }) => useAiSidebarHistory(m as never), {
      initialProps: { m: [] as unknown[] },
    });
    act(() => rerender({ m: msgs as unknown[] }));
    act(() => vi.advanceTimersByTime(800));
    const after = stored();
    expect(after.length).toBe(50);
    expect(after.some((s) => s.id === result.current.currentSessionId)).toBe(true);
    expect(after.some((s) => s.id === "old-0")).toBe(false);
  });

  it("C: persists a new conversation immediately (leading-edge) so a mid-stream reload is not lost", () => {
    const msgs = [makeMsg("user", "hello"), makeMsg("assistant", "hi")];
    const { rerender } = renderHook(({ m }) => useAiSidebarHistory(m as never), {
      initialProps: { m: [] as unknown[] },
    });
    act(() => rerender({ m: msgs as unknown[] }));
    // No timer advance — leading-edge write must already have happened.
    expect(stored().length).toBe(1);
  });
});

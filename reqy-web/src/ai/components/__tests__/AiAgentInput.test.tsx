import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { renderHook, act } from "@testing-library/react";
import { useAiAgentInput } from "@/src/ai/hooks/use-ai-agent-input";
import { createDefaultCommands } from "@/src/ai/agent/commands";

afterEach(() => cleanup());

describe("useAiAgentInput", () => {
  it("detects a slash query and filters commands", () => {
    const { result } = renderHook(() => useAiAgentInput(createDefaultCommands(), vi.fn()));
    act(() => result.current.handleChange("/cle"));
    expect(result.current.commandQuery).toBe("cle");
    expect(result.current.commandResults.map((c) => c.name)).toContain("clear");
  });

  it("accepts a command and clears the input", () => {
    const run = vi.fn();
    const { result } = renderHook(() => useAiAgentInput(createDefaultCommands(), run));
    act(() => result.current.handleChange("/clear"));
    act(() => result.current.acceptCommand("clear"));
    expect(run).toHaveBeenCalledWith("clear", "");
    expect(result.current.value).toBe("");
  });

  it("acceptMention strips the @token from the input value", () => {
    const { result } = renderHook(() => useAiAgentInput([], vi.fn()));
    act(() => result.current.handleChange("analyse @pay"));
    expect(result.current.mentionQuery).toBe("pay");
    act(() =>
      result.current.acceptMention({
        id: "collection:c1",
        type: "collection",
        refId: "c1",
        label: "Payments",
      }),
    );
    // The @mention text should be removed from the input value
    // replace(/@\S*$/, " ") replaces "@pay" with " " — the leading space stays
    expect(result.current.value).toBe("analyse  ");
    expect(result.current.mentionQuery).toBeNull();
  });

  it("clears value and autocomplete state", () => {
    const { result } = renderHook(() => useAiAgentInput(createDefaultCommands(), vi.fn()));
    act(() => result.current.handleChange("/help"));
    expect(result.current.commandQuery).toBe("help");
    act(() => result.current.clear());
    expect(result.current.value).toBe("");
    expect(result.current.commandQuery).toBeNull();
  });
});

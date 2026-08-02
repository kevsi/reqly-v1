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

  it("adds a mention attachment and removes the @token", () => {
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
    expect(result.current.attachments).toHaveLength(1);
    expect(result.current.value).toContain("analyse");
    expect(result.current.mentionQuery).toBeNull();
  });

  it("does not duplicate an attachment already selected", () => {
    const { result } = renderHook(() => useAiAgentInput([], vi.fn()));
    const att = {
      id: "request:r1",
      type: "request" as const,
      refId: "r1",
      label: "Get users",
    };
    act(() => result.current.acceptMention(att));
    act(() => result.current.acceptMention(att));
    expect(result.current.attachments).toHaveLength(1);
  });

  it("removes a mention attachment", () => {
    const { result } = renderHook(() => useAiAgentInput([], vi.fn()));
    act(() =>
      result.current.acceptMention({
        id: "environment:e1",
        type: "environment",
        refId: "e1",
        label: "Prod",
      }),
    );
    act(() => result.current.removeAttachment("environment:e1"));
    expect(result.current.attachments).toHaveLength(0);
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

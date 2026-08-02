import { describe, it, expect, vi } from "vitest";
import { parseSlashCommand, buildCommandMenu, createDefaultCommands, type SlashCommandContext } from "../commands";

const ctx: SlashCommandContext = {
  clearMessages: vi.fn(),
  newSession: vi.fn(),
  setMode: vi.fn(),
  openRules: vi.fn(),
  openPermissions: vi.fn(),
  compact: vi.fn(),
  exportSession: vi.fn(),
};

describe("ai-agent commands", () => {
  it("parses a slash command with args", () => {
    expect(parseSlashCommand("/compact 3")).toEqual({ name: "compact", args: "3" });
  });

  it("returns null for plain text", () => {
    expect(parseSlashCommand("crée une collection")).toBeNull();
    expect(parseSlashCommand("/")).toBeNull();
  });

  it("filters the command menu by name or description", () => {
    const cmds = createDefaultCommands();
    expect(buildCommandMenu("cle", cmds).some((c) => c.name === "clear")).toBe(true);
    expect(buildCommandMenu("zzz", cmds)).toHaveLength(0);
  });

  it("wires default commands to context callbacks", () => {
    const cmds = createDefaultCommands();
    const clear = cmds.find((c) => c.name === "clear")!;
    clear.run("", ctx);
    expect(ctx.clearMessages).toHaveBeenCalled();
    const plan = cmds.find((c) => c.name === "plan")!;
    plan.run("", ctx);
    expect(ctx.setMode).toHaveBeenCalledWith("plan");
  });
});

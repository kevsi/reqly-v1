import {
  authorizeTool,
  authorizeToolCall,
  canSavePermission,
  isHighImpactTool,
} from "../permissions";
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockStore = new Map<string, unknown>();
vi.mock("@/lib/persistence", () => ({
  persistence: {
    getItem: (k: string) => mockStore.get(k) ?? null,
    setItem: (k: string, v: unknown) => {
      mockStore.set(k, v);
      return Promise.resolve();
    },
  },
}));

import {
  isSideEffectTool,
  isReadOnlyTool,
  defaultPermission,
  getPermission,
  savePermission,
  loadPermissions,
} from "../permissions";

describe("authorizeTool", () => {
  beforeEach(() => mockStore.clear());

  it("denies an explicitly denied tool even when confirmed", () => {
    savePermission("execute_request", "deny");
    expect(authorizeTool("execute_request", true)).toEqual({
      allowed: false,
      reason: "denied",
    });
  });

  it("requires confirmation for side effects by default", () => {
    expect(authorizeTool("execute_request", false)).toEqual({
      allowed: false,
      reason: "confirmation_required",
    });
  });

  it("allows read-only tools without confirmation", () => {
    expect(authorizeTool("list_collections", false)).toEqual({ allowed: true });
  });
});

describe("ai-agent permissions", () => {
  beforeEach(() => mockStore.clear());

  it("classifies every REQLY_TOOLS mutator as side-effect", () => {
    for (const name of [
      "create_collection",
      "create_request",
      "execute_request",
      "rename_collection",
      "delete_collection",
      "create_environment",
      "update_environment_variable",
      "delegate",
    ]) {
      expect(isSideEffectTool(name), name).toBe(true);
    }
  });

  it("classifies read-only tools", () => {
    expect(isReadOnlyTool("list_collections")).toBe(true);
    expect(isReadOnlyTool("get_request_context")).toBe(true);
    expect(isReadOnlyTool("delete_collection")).toBe(false);
  });

  it("defaults side-effect tools to ask and read-only to allow", () => {
    expect(defaultPermission("delete_collection")).toBe("ask");
    expect(defaultPermission("create_request")).toBe("ask");
    expect(defaultPermission("update_environment_variable")).toBe("ask");
    expect(defaultPermission("list_collections")).toBe("allow");
  });

  it("refuses persisted allow overrides for high-impact tools", () => {
    expect(savePermission("delete_collection", "allow")).toBe(false);
    expect(getPermission("delete_collection")).toBe("ask");
  });

  it("falls back to default when not overridden", () => {
    expect(getPermission("execute_request")).toBe("ask");
    expect(getPermission("list_collections")).toBe("allow");
  });

  it("refuses unknown tools by default", () => {
    expect(defaultPermission("future_mutator")).toBe("deny");
    expect(authorizeToolCall("future_mutator")).toMatchObject({
      allowed: false,
      permission: "deny",
    });
  });

  it("requires explicit approval for high-impact tools even with autoApply", () => {
    expect(isHighImpactTool("execute_request")).toBe(true);
    expect(authorizeToolCall("execute_request", "autoApply").requiresConfirmation).toBe(true);
    expect(authorizeToolCall("execute_request", "user").allowed).toBe(true);
  });

  it("does not allow persisting allow for high-impact tools", () => {
    expect(canSavePermission("delete_collection", "allow")).toBe(false);
  });

  it("persists a map keyed by tool name", () => {
    savePermission("a", "allow");
    savePermission("b", "deny");
    expect(loadPermissions()).toEqual({ a: "allow", b: "deny" });
  });
});

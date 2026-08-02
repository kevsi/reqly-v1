import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Collection, Environment } from "@/hooks/request-types";

const state = {
  collections: [] as Collection[],
  environments: [] as Environment[],
  lastResponse: null as { body?: unknown } | null,
};

vi.mock("@/hooks/use-request-store", () => ({
  requestStore: { getState: () => state },
}));

import { searchContextTargets, resolveAttachmentSnippet, attachmentsToPrompt } from "../context-picker";

const col: Collection = {
  id: "col-1",
  name: "Payments API",
  requests: [
    { id: "req-1", name: "Get payment", method: "GET", url: "https://api.example.com/payments/1" },
  ],
} as unknown as Collection;

describe("ai-agent context-picker", () => {
  beforeEach(() => {
    state.collections = [col];
    state.environments = [{ id: "env-1", name: "Prod", variables: [{ key: "TOKEN", value: "abc123" }] }];
    state.lastResponse = { body: { ok: true } };
  });

  it("searches collections, requests and environments by name", () => {
    expect(searchContextTargets("api")).toHaveLength(1);
    expect(searchContextTargets("api")[0].type).toBe("collection");
    expect(searchContextTargets("get")[0].type).toBe("request");
    expect(searchContextTargets("prod")[0].type).toBe("environment");
  });

  it("resolves a collection to a markdown listing", () => {
    const out = resolveAttachmentSnippet({ id: "c", type: "collection", refId: "col-1", label: "x" });
    expect(out).toContain("Payments API");
    expect(out).toContain("GET Get payment");
  });

  it("masks environment variable secrets", () => {
    const out = resolveAttachmentSnippet({ id: "e", type: "environment", refId: "env-1", label: "x" });
    expect(out).toContain("TOKEN");
    expect(out).not.toContain("abc123");
  });

  it("resolves the last response body", () => {
    const out = resolveAttachmentSnippet({ id: "r", type: "response", refId: "", label: "x" });
    expect(out).toContain("ok");
  });

  it("joins multiple attachments into a prompt block", () => {
    const block = attachmentsToPrompt([
      { id: "c", type: "collection", refId: "col-1", label: "x" },
      { id: "e", type: "environment", refId: "env-1", label: "x" },
    ]);
    expect(block).toContain("## Contexte attaché");
    expect(block).toContain("Payments API");
    expect(block).toContain("Prod");
  });
});

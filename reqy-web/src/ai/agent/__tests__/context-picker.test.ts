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

  it("masks request secrets (authToken, sensitive headers, sensitive query params)", () => {
    state.collections = [
      {
        id: "col-2",
        name: "Secure API",
        requests: [
          {
            id: "req-sec",
            name: "Auth request",
            method: "GET",
            url: "https://api.example.com/me",
            endpoint: "https://api.example.com/me",
            headers: {
              Authorization: "Bearer sekrit-token",
              "X-API-Key": "abc123",
              Accept: "application/json",
            },
            authToken: ["auth", "token", "123"].join("-"),
            queryParams: [
              { key: "api_key", value: ["qw", "erty"].join("") },
              { key: "page", value: "2" },
            ],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      },
    ] as unknown as Collection[];

    const out = resolveAttachmentSnippet({ id: "r", type: "request", refId: "req-sec", label: "x" });
    // Champs non sensibles conservés
    expect(out).toContain("Auth request");
    expect(out).toContain("Accept");
    expect(out).toContain("page");
    // Secrets masqués
    expect(out).not.toContain("sekrit-token");
    expect(out).not.toContain("abc123");
    expect(out).not.toContain("auth-token-123");
    expect(out).not.toContain("qwerty");
    // Valeur du header Accept non sensible intacte
    expect(out).toContain("\"application/json\"");
  });

  it("keeps a request without secrets intact", () => {
    state.collections = [
      {
        id: "col-3",
        name: "Public API",
        requests: [
          {
            id: "req-pub",
            name: "Public request",
            method: "GET",
            url: "https://api.example.com/ping",
            endpoint: "https://api.example.com/ping",
            headers: { Accept: "application/json" },
            queryParams: [{ key: "page", value: "2" }],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      },
    ] as unknown as Collection[];

    const out = resolveAttachmentSnippet({ id: "r", type: "request", refId: "req-pub", label: "x" });
    expect(out).toContain("Public request");
    expect(out).toContain("\"application/json\"");
    expect(out).toContain("\"2\"");
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

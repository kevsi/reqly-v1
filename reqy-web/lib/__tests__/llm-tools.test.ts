import { describe, expect, it } from "vitest";
import { parseExecuteRequestArgs } from "@/lib/llm-tools";

describe("parseExecuteRequestArgs", () => {
  it("accepts a valid HTTP request", () => {
    expect(
      parseExecuteRequestArgs({
        method: "post",
        url: "https://api.example.com/items",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
    ).toEqual({
      value: {
        method: "POST",
        url: "https://api.example.com/items",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
    });
  });

  it("rejects unsupported methods and header injection", () => {
    expect(parseExecuteRequestArgs({ method: "TRACE", url: "https://example.com" })).toEqual({
      error: "Méthode HTTP non supportée.",
    });
    expect(
      parseExecuteRequestArgs({
        method: "GET",
        url: "https://example.com",
        headers: { X: "ok\r\nInjected: yes" },
      }),
    ).toEqual({ error: "Headers invalides." });
  });

  it("rejects non-http URLs and oversized bodies", () => {
    expect(parseExecuteRequestArgs({ method: "GET", url: "file:///tmp/a" })).toEqual({
      error: "URL invalide : protocole HTTP/HTTPS requis.",
    });
    expect(
      parseExecuteRequestArgs({
        method: "POST",
        url: "https://example.com",
        body: "x".repeat(1_000_001),
      }),
    ).toEqual({ error: "Body trop volumineux." });
  });
});

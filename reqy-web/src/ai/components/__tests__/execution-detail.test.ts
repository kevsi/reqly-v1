import { describe, it, expect } from "vitest";
import { parseExecutionDetail } from "@/src/ai/components/assistant-steps-renderer";

describe("parseExecutionDetail", () => {
  it("parses method, url, status, duration and body", () => {
    const r = parseExecutionDetail("GET https://api.example.com/users → 200 en 42ms\n[1,2]");
    expect(r).toEqual({
      method: "GET",
      url: "https://api.example.com/users",
      status: 200,
      durationMs: 42,
      body: "[1,2]",
    });
  });

  it("returns null for non-HTTP detail", () => {
    expect(parseExecutionDetail("Collection 'Tests API' créée.")).toBeNull();
    expect(parseExecutionDetail(undefined)).toBeNull();
  });

  it("tolerates lowercase method and missing body", () => {
    const r = parseExecutionDetail("post /api → 500");
    expect(r?.method).toBe("POST");
    expect(r?.status).toBe(500);
    expect(r?.durationMs).toBeNull();
    expect(r?.body).toBe("");
  });
});

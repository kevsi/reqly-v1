import { describe, it, expect } from "vitest";
import { parseRequestDescription } from "@/src/ai/cloud-engine/heuristic-parser";

describe("parseRequestDescription", () => {
  it("parses method + URL", () => {
    const r = parseRequestDescription("GET https://api.example.com/users");
    expect(r.method).toBe("GET");
    expect(r.url).toBe("https://api.example.com/users");
  });

  it("defaults to GET when no method is found", () => {
    const r = parseRequestDescription("List users from /api/users");
    expect(r.method).toBe("GET");
    expect(r.url).toBe("/api/users");
  });

  it("detects POST from action keyword", () => {
    const r = parseRequestDescription("Create a new user at https://api.example.com/users");
    expect(r.method).toBe("POST");
  });

  it("detects PUT from action keyword", () => {
    const r = parseRequestDescription("Update the order at /v1/orders/123");
    expect(r.method).toBe("PUT");
  });

  it("detects PATCH from action keyword", () => {
    const r = parseRequestDescription("Partial update /users/1 with name change");
    expect(r.method).toBe("PATCH");
  });

  it("detects DELETE from action keyword", () => {
    const r = parseRequestDescription("Delete the resource at /v1/items/42");
    expect(r.method).toBe("DELETE");
  });

  it("extracts Authorization header", () => {
    const r = parseRequestDescription(
      "GET https://api.example.com/me with authorization: Bearer abc"
    );
    const auth = r.headers.find((h) => h.key === "Authorization");
    expect(auth?.value).toBe("Bearer abc");
  });

  it("normalizes bare 'bearer xxx' to Authorization Bearer", () => {
    const r = parseRequestDescription("GET https://x.com with bearer my-token-123");
    const auth = r.headers.find((h) => h.key === "Authorization");
    expect(auth?.value).toBe("Bearer my-token-123");
  });

  it("extracts Content-Type header", () => {
    const r = parseRequestDescription(
      "POST https://x.com with content-type: application/json"
    );
    const ct = r.headers.find((h) => h.key === "Content-Type");
    expect(ct?.value).toBe("application/json");
  });

  it("extracts JSON body for non-GET methods", () => {
    const r = parseRequestDescription(
      'POST https://api.example.com/users with body { "name": "Alice", "age": 30 }'
    );
    expect(r.body).toBe('{"name":"Alice","age":30}');
  });

  it("does not extract body for GET methods", () => {
    const r = parseRequestDescription(
      'GET https://x.com/items with body { "ignore": true }'
    );
    expect(r.body).toBeUndefined();
  });

  it("ignores malformed JSON in body", () => {
    const r = parseRequestDescription(
      "POST https://x.com with body { broken json "
    );
    expect(r.body).toBeUndefined();
  });

  it("extracts path-only URL when no full URL", () => {
    const r = parseRequestDescription("List the /v2/projects endpoint");
    expect(r.url).toBe("/v2/projects");
  });

  it("extracts nested JSON body", () => {
    const r = parseRequestDescription(
      'POST /users with body { "profile": { "name": "Alice", "tags": ["a", "b"] } }'
    );
    expect(r.body).toBe('{"profile":{"name":"Alice","tags":["a","b"]}}');
  });
});

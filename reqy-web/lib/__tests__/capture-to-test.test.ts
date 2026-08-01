import { describe, it, expect } from "vitest";
import {
  generateCollectionFromCapture,
  type CapturedRequest,
} from "@/lib/capture-to-test/generate";

function makeSession(i: number, overrides: Partial<CapturedRequest> = {}): CapturedRequest {
  return {
    id: `cap-${i}`,
    method: i % 2 === 0 ? "GET" : "POST",
    url: `https://api.example.com/resource/${i}`,
    headers: [["Content-Type", "application/json"]],
    body: null,
    timestamp: 1_700_000_000_000 + i,
    status: 200,
    responseHeaders: [["Content-Type", "application/json"]],
    responseBody: null,
    durationMs: 12,
    error: null,
    ...overrides,
  };
}

describe("generateCollectionFromCapture", () => {
  it("returns one request per captured session, each with >= 1 assertion", () => {
    const sessions = Array.from({ length: 10 }, (_, i) => makeSession(i));
    const bundle = generateCollectionFromCapture(sessions);
    expect(bundle.collections).toHaveLength(1);
    const requests = bundle.collections[0].requests;
    expect(requests).toHaveLength(10);
    for (const r of requests) {
      expect(r.runnerAssertions.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("infers a status assertion and JSON schema/field assertions from a JSON body", () => {
    const sessions = [
      makeSession(0, {
        status: 201,
        responseBody: JSON.stringify({ id: 1, name: "x", tags: ["a"] }),
      }),
    ];
    const bundle = generateCollectionFromCapture(sessions);
    const req = bundle.collections[0].requests[0];

    // (a) status assertion from the observed response status
    const statusAssert = req.runnerAssertions.find((a) => a.type === "status");
    expect(statusAssert).toBeDefined();
    if (statusAssert && statusAssert.type === "status") {
      expect(statusAssert.expected).toBe(201);
    }

    // (b) presence of key body fields
    const present = req.runnerAssertions
      .filter((a) => a.type === "jsonPath" && a.operator === "exists")
      .map((a) => (a.type === "jsonPath" ? a.path : ""));
    expect(present).toEqual(expect.arrayContaining(["id", "name", "tags"]));

    // (c) field types via inferred JSON schema
    expect(req.runnerAssertions.some((a) => a.type === "schema")).toBe(true);
  });

  it("falls back to a generic 2xx band when no status was observed", () => {
    const sessions = [makeSession(0, { status: null })];
    const bundle = generateCollectionFromCapture(sessions);
    const req = bundle.collections[0].requests[0];
    const statusAssert = req.runnerAssertions.find((a) => a.type === "status");
    expect(statusAssert).toBeDefined();
    if (statusAssert && statusAssert.type === "status") {
      expect(Array.isArray((statusAssert.expected as { in: number[] }).in)).toBe(true);
    }
  });

  it("skips body assertions for non-JSON or empty bodies but still asserts status", () => {
    const sessions = [
      makeSession(1, { responseBody: "<html>not json</html>" }),
      makeSession(2, { responseBody: "" }),
      makeSession(3, { responseBody: null }),
    ];
    const bundle = generateCollectionFromCapture(sessions);
    for (const req of bundle.collections[0].requests) {
      // status assertion must always be present
      expect(req.runnerAssertions.some((a) => a.type === "status")).toBe(true);
      // no schema/jsonPath assertions for malformed/empty bodies
      expect(req.runnerAssertions.some((a) => a.type === "schema")).toBe(false);
      expect(req.runnerAssertions.some((a) => a.type === "jsonPath")).toBe(false);
    }
  });

  it("still produces assertions when the observed status is an error code", () => {
    const sessions = [makeSession(4, { status: 500 })];
    const bundle = generateCollectionFromCapture(sessions);
    const req = bundle.collections[0].requests[0];
    const statusAssert = req.runnerAssertions.find((a) => a.type === "status");
    expect(statusAssert).toBeDefined();
    if (statusAssert && statusAssert.type === "status") {
      expect(statusAssert.expected).toBe(500);
    }
  });

  it("maps captured headers into a flat record", () => {
    const sessions = [
      makeSession(5, {
        headers: [
          ["X-Token", "abc"],
          ["Accept", "application/json"],
        ],
      }),
    ];
    const bundle = generateCollectionFromCapture(sessions);
    const req = bundle.collections[0].requests[0];
    expect(req.headers?.["X-Token"]).toBe("abc");
    expect(req.headers?.["Accept"]).toBe("application/json");
  });
});

import { describe, it, expect } from "vitest";
import { parseSpec, checkContract } from "../contract.js";
import type { RunResult } from "../types.js";

const SPEC = JSON.stringify({
  openapi: "3.0.0",
  info: { title: "Demo", version: "1.0" },
  servers: [{ url: "https://api.example.com" }],
  paths: {
    "/users/{id}": {
      get: {
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/User" },
              },
            },
          },
        },
      },
    },
    "/health": {
      get: {
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["status"],
                  properties: { status: { type: "string" } },
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      User: {
        type: "object",
        required: ["id", "name"],
        properties: {
          id: { type: "integer" },
          name: { type: "string" },
          email: { type: "string" },
        },
      },
    },
  },
});

function runResult(over: Partial<RunResult>): RunResult {
  return {
    name: "r",
    method: "GET",
    url: "https://api.example.com/users/42",
    status: 200,
    statusText: "OK",
    durationMs: 10,
    size: 0,
    passed: true,
    timestamp: 0,
    ...over,
  };
}

describe("contract — schema resolution", () => {
  it("inlines $ref to components/schemas and validates a conforming body", () => {
    const doc = parseSpec(SPEC);
    const checks = checkContract(
      [runResult({ body: JSON.stringify({ id: 42, name: "Ada" }) })],
      doc,
    );
    expect(checks[0].schemaFound).toBe(true);
    expect(checks[0].assertion?.passed).toBe(true);
  });

  it("reports a violation when a required field is missing", () => {
    const doc = parseSpec(SPEC);
    const checks = checkContract(
      [runResult({ body: JSON.stringify({ id: 42 }) })], // missing "name"
      doc,
    );
    expect(checks[0].schemaFound).toBe(true);
    expect(checks[0].assertion?.passed).toBe(false);
    expect(checks[0].assertion?.error).toMatch(/name/);
  });
});

describe("contract — path matching", () => {
  it("matches a concrete path against a {param} template", () => {
    const doc = parseSpec(SPEC);
    const checks = checkContract(
      [
        runResult({
          url: "https://api.example.com/users/999",
          body: JSON.stringify({ id: 1, name: "x" }),
        }),
      ],
      doc,
    );
    expect(checks[0].schemaFound).toBe(true);
    expect(checks[0].assertion?.passed).toBe(true);
  });

  it("reports no schema when the path is undocumented", () => {
    const doc = parseSpec(SPEC);
    const checks = checkContract(
      [runResult({ url: "https://api.example.com/unknown", body: "{}" })],
      doc,
    );
    expect(checks[0].schemaFound).toBe(false);
    expect(checks[0].assertion).toBeUndefined();
  });
});

describe("contract — edge cases", () => {
  it("skips requests that did not reach an HTTP response (status 0)", () => {
    const doc = parseSpec(SPEC);
    const checks = checkContract(
      [
        runResult({
          status: 0,
          statusText: "Error",
          passed: false,
          error: "network",
          body: undefined,
        }),
      ],
      doc,
    );
    expect(checks[0].schemaFound).toBe(false);
    expect(checks[0].assertion).toBeUndefined();
  });

  it("falls back to a 2XX wildcard when the exact status is absent", () => {
    const wildcardSpec = JSON.stringify({
      openapi: "3.0.0",
      info: { title: "t", version: "1" },
      servers: [{ url: "https://api.example.com" }],
      paths: {
        "/ping": {
          get: {
            responses: {
              "2XX": {
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      required: ["pong"],
                      properties: { pong: { type: "boolean" } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    const doc = parseSpec(wildcardSpec);
    const checks = checkContract(
      [
        runResult({
          url: "https://api.example.com/ping",
          status: 204,
          body: JSON.stringify({ pong: true }),
        }),
      ],
      doc,
    );
    expect(checks[0].schemaFound).toBe(true);
    expect(checks[0].assertion?.passed).toBe(true);
  });

  it("matches the status default response", () => {
    const defaultSpec = JSON.stringify({
      openapi: "3.0.0",
      info: { title: "t", version: "1" },
      servers: [{ url: "https://api.example.com" }],
      paths: {
        "/x": {
          get: {
            responses: {
              default: { content: { "application/json": { schema: { type: "string" } } } },
            },
          },
        },
      },
    });
    const doc = parseSpec(defaultSpec);
    const checks = checkContract(
      [
        runResult({
          url: "https://api.example.com/x",
          status: 418,
          body: JSON.stringify("teapot"),
        }),
      ],
      doc,
    );
    expect(checks[0].schemaFound).toBe(true);
  });
});

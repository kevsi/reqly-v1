import { describe, it, expect } from "vitest";
import { importFromOpenApi } from "../../openapi.js";

describe("mcp openapi import — OpenAPI 3.1 support", () => {
  it("pulls a request body from a 3.1 named examples map", () => {
    const spec = {
      openapi: "3.1.0",
      info: { title: "T", version: "1.0" },
      paths: {
        "/items": {
          post: {
            requestBody: {
              content: {
                "application/json": {
                  examples: { full: { value: { name: "x", qty: 3 } } },
                },
              },
            },
          },
        },
      },
    };
    const result = importFromOpenApi(JSON.stringify(spec));
    expect(result.success).toBe(true);
    const req = result.success ? result.collections[0]!.requests[0] : undefined;
    expect(req?.body).toBe(JSON.stringify({ name: "x", qty: 3 }));
  });

  it("resolves a $ref schema example into the request body", () => {
    const spec = {
      openapi: "3.1.0",
      info: { title: "T", version: "1.0" },
      paths: {
        "/users": {
          post: {
            requestBody: {
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/User" },
                },
              },
            },
          },
        },
      },
      components: { schemas: { User: { type: "object", example: { name: "ada" } } } },
    };
    const result = importFromOpenApi(JSON.stringify(spec));
    expect(result.success).toBe(true);
    const req = result.success ? result.collections[0]!.requests[0] : undefined;
    expect(req?.body).toBe(JSON.stringify({ name: "ada" }));
  });

  it("falls back to servers[0] for the base URL in 3.1", () => {
    const spec = {
      openapi: "3.1.0",
      info: { title: "T", version: "1.0" },
      servers: [{ url: "https://api.example.com/v2" }],
      paths: {
        "/ping": { get: {} },
      },
    };
    const result = importFromOpenApi(JSON.stringify(spec));
    if (!result.success) throw new Error("import failed");
    expect(result.baseUrl).toBe("https://api.example.com/v2");
  });
});

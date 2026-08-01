import { describe, it, expect } from "vitest";
import { buildRequestContext } from "@/src/ai/local-engine/context";
import type { RequestPayload, ResponsePayload, NetworkError } from "@/src/ai/types";

describe("buildRequestContext", () => {
  it("builds a context from a successful request/response", () => {
    const req: RequestPayload = {
      method: "GET",
      url: "https://api.example.com/users",
      headers: { accept: "application/json" },
      body: null,
      authType: "none",
    };
    const res: ResponsePayload = {
      status: 200,
      statusText: "OK",
      headers: { "content-type": "application/json" },
      body: { users: [] },
      duration: 42,
      size: 15,
    };
    const ctx = buildRequestContext(req, res);
    expect(ctx.request).toEqual(req);
    expect(ctx.response).toEqual(res);
    expect(ctx.error).toBeUndefined();
    expect(typeof ctx.timestamp).toBe("number");
    expect(Date.now() - ctx.timestamp).toBeLessThan(100);
  });

  it("builds a context from a network error only", () => {
    const req: RequestPayload = {
      method: "POST", url: "https://api.example.com/x", headers: {}, body: {}, authType: "bearer",
    };
    const err: NetworkError = { message: "connect ECONNREFUSED", code: "ECONNREFUSED", type: "network" };
    const ctx = buildRequestContext(req, undefined, err);
    expect(ctx.response).toBeUndefined();
    expect(ctx.error).toEqual(err);
  });

  it("infers authType from Authorization header when not provided", () => {
    const req: RequestPayload = {
      method: "GET", url: "https://x", headers: { authorization: "Bearer abc" }, body: null, authType: "none",
    };
    const ctx = buildRequestContext(req);
    expect(ctx.request.authType).toBe("bearer");
  });

  it("infers basic authType", () => {
    const req: RequestPayload = {
      method: "GET", url: "https://x", headers: { authorization: "Basic dXNlcjpwYXNz" }, body: null, authType: "none",
    };
    const ctx = buildRequestContext(req);
    expect(ctx.request.authType).toBe("basic");
  });
});

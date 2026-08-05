import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { executeRequest as mcpExecuteRequest, executeRequestWithAssertions } from "../runner.js";
import { runResultToAssertionContext, evaluateAssertions } from "../assertions.js";
import type { RequestItem } from "../types.js";

describe("mcp runner — response headers propagate to assertions", () => {
  it("asserts on a response header returned by the underlying runner", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("hello", {
          status: 200,
          headers: { "content-type": "application/json", "x-api-key": "secret-123" },
        }),
      ),
    );

    const request: RequestItem = {
      id: "r1",
      name: "header-test",
      method: "GET",
      url: "https://httpbin.org/anything",
      endpoint: "https://httpbin.org/anything",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      runnerAssertions: [
        { type: "header", target: "x-api-key", operator: "eq", value: "secret-123" },
        { type: "header", target: "x-missing", operator: "exists" },
      ],
    };

    const result = await executeRequestWithAssertions(request, {
      timeoutMs: 5000,
      allowLocalHosts: true,
      maxResponseSize: 1024 * 1024,
    });

    expect(result.responseHeaders?.["x-api-key"]).toBe("secret-123");
    const headerOk = result.assertionResults?.find((a) => a.assertion.target === "x-api-key");
    expect(headerOk?.passed).toBe(true);
    const headerMissing = result.assertionResults?.find((a) => a.assertion.target === "x-missing");
    expect(headerMissing?.passed).toBe(false);
  });
});

describe("mcp runner — maxResponseSize is enforced", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("x".repeat(1024 * 1024 + 1), {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
      ),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("fails a request whose body exceeds the cap", async () => {
    const request: RequestItem = {
      id: "r2",
      name: "big-response",
      method: "GET",
      url: "https://httpbin.org/anything",
      endpoint: "https://httpbin.org/anything",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const result = await mcpExecuteRequest(request, {
      timeoutMs: 5000,
      allowLocalHosts: true,
      maxResponseSize: 1024, // 1 KB cap
    });

    expect(result.passed).toBe(false);
    expect(result.error).toContain("maximum allowed size");
  });

  it("allows a body under the cap", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const request: RequestItem = {
      id: "r3",
      name: "small-response",
      method: "GET",
      url: "https://httpbin.org/anything",
      endpoint: "https://httpbin.org/anything",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const result = await mcpExecuteRequest(request, {
      timeoutMs: 5000,
      allowLocalHosts: true,
      maxResponseSize: 1024,
    });

    expect(result.passed).toBe(true);
    expect(result.error).toBeUndefined();
  });
});

describe("runResultToAssertionContext", () => {
  it("exposes responseHeaders to header assertions", () => {
    const context = runResultToAssertionContext({
      name: "n",
      method: "GET",
      url: "u",
      status: 200,
      statusText: "OK",
      durationMs: 10,
      size: 1,
      passed: true,
      responseHeaders: { "x-test": "yes" },
    });

    const results = evaluateAssertions(
      [{ type: "header", target: "x-test", operator: "eq", value: "yes" }],
      context,
    );
    expect(results[0].passed).toBe(true);
  });
});

describe("mcp runner — variables resolve before the SSRF check", () => {
  const makeRequest = (url: string): RequestItem => ({
    id: "r1",
    name: "var-test",
    method: "GET",
    url,
    endpoint: url,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("runs a request whose {{var}} URL resolves to a safe public target", async () => {
    // BASE_URL is an IP literal so the SSRF guard short-circuits without DNS.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 })));
    const request = makeRequest("{{BASE_URL}}/posts");
    const result = await mcpExecuteRequest(
      request,
      {
        timeoutMs: 5000,
        envName: "prod",
        allowLocalHosts: false,
        maxResponseSize: 1024 * 1024,
      },
      [
        {
          name: "prod",
          variables: [{ key: "BASE_URL", value: "http://8.8.8.8", enabled: true }],
        },
      ],
    );
    // Regression: previously the guard ran on the raw "{{BASE_URL}}/posts" and
    // blocked it as "Invalid URL" before any interpolation.
    expect(result.status).toBe(200);
    expect(result.passed).toBe(true);
  });

  it("still blocks when the variable is unresolved", async () => {
    const request = makeRequest("{{BASE_URL}}/posts");
    const result = await mcpExecuteRequest(
      request,
      {
        timeoutMs: 5000,
        envName: "prod",
        allowLocalHosts: false,
        maxResponseSize: 1024 * 1024,
      },
      [],
    ); // no environments → {{BASE_URL}} stays literal → invalid URL
    expect(result.statusText).toBe("Blocked");
    expect(result.passed).toBe(false);
  });
});

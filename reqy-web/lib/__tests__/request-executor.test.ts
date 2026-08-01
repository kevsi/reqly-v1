import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  normalizeUrl,
  buildUrl,
  buildHeaders,
  sanitizeUrl,
  buildRequestPayload,
  executeRequest,
} from "@/lib/request-executor";
import type { Header, QueryParam, BodyType, RequestTab } from "@/lib/request-executor";

const { enqueueMock } = vi.hoisted(() => ({
  enqueueMock: vi.fn(),
}));

vi.mock("@/lib/offline/queue", () => ({
  classifyError: (error: unknown) => {
    if (error instanceof TypeError) return "network";
    if (error instanceof Error && error.name === "AbortError") return "network";
    return "unknown";
  },
  enqueueOnNetworkFailure: enqueueMock,
}));

vi.mock("@/lib/tauri", () => ({
  invokeTauriFetch: vi.fn().mockRejectedValue(new TypeError("fetch failed")),
}));

beforeEach(() => {
  enqueueMock.mockReset();
  enqueueMock.mockRejectedValue(new Error("queue unavailable"));
});

describe("sanitizeUrl", () => {
  it("trims whitespace", () => {
    expect(sanitizeUrl("  http://example.com  ")).toBe("http://example.com");
  });

  it("removes HTTP method prefix", () => {
    expect(sanitizeUrl("GET http://example.com/api")).toBe("http://example.com/api");
    expect(sanitizeUrl("POST http://example.com/api")).toBe("http://example.com/api");
  });

  it("fixes protocol with missing slash", () => {
    expect(sanitizeUrl("https:/example.com")).toBe("https://example.com");
  });

  it("fixes multiple slashes after protocol", () => {
    expect(sanitizeUrl("https:///example.com")).toBe("https://example.com");
  });
});

describe("normalizeUrl", () => {
  it("adds https:// for hostnames with dots", () => {
    expect(normalizeUrl("example.com/api")).toBe("https://example.com/api");
  });

  it("adds http:// for localhost", () => {
    expect(normalizeUrl("localhost:3000/api")).toBe("http://localhost:3000/api");
  });

  it("adds http:// for IP addresses", () => {
    expect(normalizeUrl("192.168.1.1:8080")).toBe("http://192.168.1.1:8080");
  });

  it("does not modify already valid https URL", () => {
    expect(normalizeUrl("https://api.example.com/v1")).toBe("https://api.example.com/v1");
  });

  it("does not modify already valid http URL", () => {
    expect(normalizeUrl("http://localhost:3000")).toBe("http://localhost:3000");
  });
});

describe("buildUrl", () => {
  it("appends query params", () => {
    const params: QueryParam[] = [
      { key: "q", value: "test" },
      { key: "page", value: "1" },
    ];
    const url = buildUrl("https://example.com/search", params);
    expect(url).toBe("https://example.com/search?q=test&page=1");
  });

  it("encodes special characters in query params", () => {
    const params: QueryParam[] = [
      { key: "name", value: "John Doe" },
      { key: "q", value: "a+b" },
    ];
    const url = buildUrl("https://example.com/search", params);
    expect(url).toContain("name=John+Doe");
    expect(url).toContain("q=a%2Bb");
  });

  it("appends params to existing query string", () => {
    const params: QueryParam[] = [{ key: "page", value: "2" }];
    const url = buildUrl("https://example.com/search?q=hello", params);
    expect(url).toContain("q=hello");
    expect(url).toContain("page=2");
  });

  it("skips empty keys or values", () => {
    const params: QueryParam[] = [
      { key: "", value: "val" },
      { key: "key", value: "" },
      { key: "valid", value: "true" },
    ];
    const url = buildUrl("https://example.com/api", params);
    expect(url).not.toContain("=val");
    expect(url).not.toContain("key=");
    expect(url).toContain("valid=true");
  });
});

describe("buildHeaders", () => {
  const defaultHeaders: Header[] = [{ key: "Accept", value: "application/json" }];

  it("includes custom headers", () => {
    const result = buildHeaders(defaultHeaders, "none", "");
    expect(result["Accept"]).toBe("application/json");
  });

  it("adds Bearer authorization", () => {
    const result = buildHeaders(defaultHeaders, "bearer", "token123");
    expect(result["Authorization"]).toBe("Bearer token123");
  });

  it("adds Basic authorization", () => {
    const result = buildHeaders(defaultHeaders, "basic", "base64creds");
    expect(result["Authorization"]).toBe("Basic base64creds");
  });

  it("adds API Key authorization", () => {
    const result = buildHeaders(defaultHeaders, "api-key", "key-abc");
    expect(result["x-api-key"]).toBe("key-abc");
  });

  it("does not add auth header when authType is none", () => {
    const result = buildHeaders(defaultHeaders, "none", "token123");
    expect(result["Authorization"]).toBeUndefined();
  });

  it("does not add auth header when token is empty", () => {
    const result = buildHeaders(defaultHeaders, "bearer", "");
    expect(result["Authorization"]).toBeUndefined();
  });
});

describe("buildRequestPayload", () => {
  const baseTab = {
    method: "POST" as const,
    url: "https://example.com/api",
    body: '{"key":"value"}',
    headers: [],
    queryParams: [],
    pathParams: [],
    authType: "none" as const,
    authToken: "",
    preRequestScript: "",
    postResponseScript: "",
    assertions: [],
  };

  const createContext = (overrides: Partial<RequestTab> = {}) => ({
    tab: { ...baseTab, ...overrides },
    allVars: [],
    activeWorkspaceId: null,
    activeProjectPort: 0,
    activeProject: false,
    nativeMode: false,
  });

  it("sets application/json for JSON body type", () => {
    const { headers } = buildRequestPayload(createContext({ bodyType: "json" }));
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("sets application/x-www-form-urlencoded for x-www-form body type", () => {
    const { headers } = buildRequestPayload(
      createContext({ bodyType: "x-www-form", body: "key=value" }),
    );
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
  });

  it("sets multipart/form-data for form-data body type", () => {
    const { headers } = buildRequestPayload(
      createContext({ bodyType: "form-data", body: "key=value" }),
    );
    expect(headers["Content-Type"]).toMatch(/^multipart\/form-data; boundary=/);
  });

  it("sets text/plain for raw body type", () => {
    const { headers } = buildRequestPayload(createContext({ bodyType: "raw" }));
    expect(headers["Content-Type"]).toBe("text/plain");
  });

  it("sets application/octet-stream for binary body type", () => {
    const { headers } = buildRequestPayload(createContext({ bodyType: "binary" }));
    expect(headers["Content-Type"]).toBe("application/octet-stream");
  });

  it("does not add Content-Type when no body", () => {
    const { headers } = buildRequestPayload(createContext({ body: "", bodyType: "json" }));
    expect(headers["Content-Type"]).toBeUndefined();
  });

  it("does not override existing Content-Type header", () => {
    const { headers } = buildRequestPayload(
      createContext({
        bodyType: "json",
        headers: [{ key: "Content-Type", value: "application/custom", enabled: true }],
      }),
    );
    expect(headers["Content-Type"]).toBe("application/custom");
  });

  it("interpolates variables in URL", () => {
    const { finalUrl } = buildRequestPayload({
      tab: { ...baseTab, url: "https://{{host}}/api/endpoint", bodyType: "json" },
      allVars: [{ key: "host", value: "api.example.com", enabled: true }],
      activeWorkspaceId: null,
      activeProjectPort: 0,
      activeProject: false,
      nativeMode: false,
    });
    expect(finalUrl).toBe("https://api.example.com/api/endpoint");
  });

  it("interpolates variables in body", () => {
    const { finalBody } = buildRequestPayload({
      tab: { ...baseTab, body: '{"name":"{{name}}"}', bodyType: "json" },
      allVars: [{ key: "name", value: "John", enabled: true }],
      activeWorkspaceId: null,
      activeProjectPort: 0,
      activeProject: false,
      nativeMode: false,
    });
    expect(finalBody).toBe('{"name":"John"}');
  });
});

describe("executeRequest", () => {
  const baseTabForExecution = {
    method: "POST" as const,
    url: "https://example.com/api",
    endpoint: "https://example.com/api",
    body: "",
    bodyType: "raw" as BodyType,
    headers: [] as Header[],
    queryParams: [] as QueryParam[],
    pathParams: [],
    authType: "none" as const,
    authToken: "",
    preRequestScript: "",
    postResponseScript: "",
    assertions: [],
    hasResponse: false,
    isSaved: false,
  };

  it("surfaces queueing failures to the caller instead of silently swallowing them", async () => {
    const result = await executeRequest({
      tab: {
        ...baseTabForExecution,
        method: "GET",
        url: "https://example.com",
        body: "",
        headers: [],
        queryParams: [],
        pathParams: [],
        authType: "none",
        authToken: "",
        hasResponse: false,
        isSaved: false,
        responseBody: "",
        responseData: "",
      } as RequestTab,
      allVars: [],
      activeProjectPort: 0,
      activeProject: false,
      nativeMode: true,
      activeWorkspaceId: null,
    });

    expect(result.responseBody).toContain("Queueing failed");
    expect(result.responseStatus).toBe(0);
  });
});

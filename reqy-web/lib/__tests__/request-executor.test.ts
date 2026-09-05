import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  executeRequest,
  sanitizeUrl,
  normalizeUrl,
  buildUrl,
  buildHeaders,
  formatSize,
  type QueryParam,
  type PathParam,
} from "../request-executor";
import * as tauriModule from "../tauri";

vi.mock("../tauri");
vi.mock("../persistence");
vi.mock("../proxy-auth", () => ({
  proxyAuthHeaders: vi.fn().mockResolvedValue({}),
}));

// Mock utils en dehors du describe
vi.mock("../utils", () => ({
  parseJsonSafe: vi.fn(),
  interpolate: (str: string) => str,
  replaceLocalhostPort: (url: string) => url,
  hasUnresolvedPlaceholders: () => false,
  cn: (...args: string[]) => args.join(" "),
  downloadJson: vi.fn(),
}));

describe("request-executor", () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    const { parseJsonSafe } = await import("../utils");
    vi.mocked(parseJsonSafe).mockResolvedValue({
      status: 200,
      body: '{"success": true}',
      headers: {},
      timings: { dns: 10, tcp: 20, ttfb: 50 },
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: () => Promise.resolve('{"status":200,"body":"{\\"success\\":true}","headers":{}}'),
    });
  });

  describe("sanitizeUrl", () => {
    it("removes method prefix", () => {
      expect(sanitizeUrl("GET https://api.example.com")).toBe("https://api.example.com");
      expect(sanitizeUrl("POST%20https://api.example.com")).toBe("https://api.example.com");
    });

    it("replaces %20 with spaces", () => {
      expect(sanitizeUrl("https://api.example.com/hello%20world")).toBe(
        "https://api.example.com/hello world",
      );
    });

    it("fixes single-slash protocol", () => {
      expect(sanitizeUrl("https:/example.com")).toBe("https://example.com");
      expect(sanitizeUrl("http:///example.com")).toBe("http://example.com");
    });
  });

  describe("normalizeUrl", () => {
    it("adds https to // prefix", () => {
      expect(normalizeUrl("//api.example.com")).toBe("https://api.example.com");
    });

    it("adds http to localhost", () => {
      expect(normalizeUrl("localhost:3000")).toBe("http://localhost:3000");
      expect(normalizeUrl("127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
    });

    it("adds https to domain-like strings", () => {
      expect(normalizeUrl("api.example.com")).toBe("https://api.example.com");
    });

    it("leaves valid URLs unchanged", () => {
      expect(normalizeUrl("https://api.example.com")).toBe("https://api.example.com");
    });
  });

  describe("buildUrl", () => {
    it("appends enabled query params", () => {
      const params: QueryParam[] = [
        { key: "page", value: "1", enabled: true },
        { key: "limit", value: "10", enabled: true },
      ];
      const result = buildUrl("https://api.example.com", params);
      expect(result).toBe("https://api.example.com/?page=1&limit=10");
    });

    it("skips disabled query params", () => {
      const params: QueryParam[] = [
        { key: "page", value: "1", enabled: true },
        { key: "limit", value: "10", enabled: false },
      ];
      const result = buildUrl("https://api.example.com", params);
      expect(result).toBe("https://api.example.com/?page=1");
    });

    it("replaces path params", () => {
      const pathParams: PathParam[] = [{ key: "id", value: "123" }];
      const result = buildUrl("https://api.example.com/users/:id", [], pathParams);
      expect(result).toBe("https://api.example.com/users/123");
    });

    it("skips query params with undefined key or value", () => {
      const params: QueryParam[] = [
        { key: "page", value: "1", enabled: true },
        { key: undefined as never, value: "no-key" },
        { key: "no-value", value: undefined as never },
      ];
      const result = buildUrl("https://api.example.com", params);
      expect(result).toBe("https://api.example.com/?page=1");
    });

    it("handles mixed path and query params", () => {
      const queryParams: QueryParam[] = [{ key: "expand", value: "profile", enabled: true }];
      const pathParams: PathParam[] = [{ key: "id", value: "456" }];
      const result = buildUrl("https://api.example.com/users/:id", queryParams, pathParams);
      expect(result).toBe("https://api.example.com/users/456?expand=profile");
    });
  });

  describe("buildHeaders", () => {
    it("does not crash when authToken is undefined (stripped on persist)", () => {
      const headers = buildHeaders([], "none", undefined as never);
      expect(headers).toEqual({});
    });

    it("skips headers with undefined key or value", () => {
      const headers = buildHeaders(
        [
          { key: "X-Foo", value: "bar" },
          { key: undefined as never, value: "no-key" },
          { key: "no-value", value: undefined as never },
        ],
        "none",
        "",
      );
      expect(headers).toEqual({ "X-Foo": "bar" });
    });
  });

  describe("formatSize", () => {
    it("formats bytes", () => {
      expect(formatSize(512)).toBe("512 B");
    });

    it("formats kilobytes", () => {
      expect(formatSize(1024)).toBe("1 KB");
      expect(formatSize(2048)).toBe("2 KB");
    });
  });

  describe("executeRequest", () => {
    it("executes GET request via proxy", async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () =>
          Promise.resolve({
            status: 200,
            body: '{"success": true}',
            headers: { "content-type": "application/json" },
          }),
      } as unknown as Response);

      const result = await executeRequest({
        tab: {
          id: "test-1",
          name: "Test",
          method: "GET",
          url: "https://api.example.com/data",
          endpoint: "/data",
          headers: [],
          queryParams: [],
          pathParams: [],
          body: "",
          bodyType: "json",
          authType: "none",
          authToken: "",
          hasResponse: false,
          isSaved: false,
        },
        allVars: [],
        activeProjectPort: 3000,
        activeProject: false,
        nativeMode: false,
        activeWorkspaceId: null,
      });

      expect(result.responseStatus).toBe(200);
      expect(result.responseBody).toBe('{"success": true}');
      expect(result.responseTime).toBeGreaterThan(0);
      // Vérifie que /api/proxy est appelé
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/proxy",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        }),
      );
    });

    it("adds bearer token to proxy request payload", async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status: 200, body: "{}", headers: {} }),
      } as unknown as Response);

      await executeRequest({
        tab: {
          id: "test-1",
          name: "Test",
          method: "GET",
          url: "https://api.example.com/data",
          endpoint: "/data",
          headers: [],
          queryParams: [],
          pathParams: [],
          body: "",
          bodyType: "json",
          authType: "bearer",
          authToken: ["secret", "123"].join(""),
          hasResponse: false,
          isSaved: false,
        },
        allVars: [],
        activeProjectPort: 3000,
        activeProject: false,
        nativeMode: false,
        activeWorkspaceId: null,
      });

      // Vérifie que le token est dans le payload envoyé au proxy
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/proxy",
        expect.objectContaining({
          body: expect.stringContaining('"Authorization":"Bearer secret123"'),
        }),
      );
    });

    it("uses Tauri fetch in native mode", async () => {
      vi.mocked(tauriModule.isTauriAvailable).mockReturnValue(true);
      vi.mocked(tauriModule.invokeTauriFetch).mockResolvedValue({
        status: 200,
        statusText: "OK",
        headers: {},
        body: '{"data": "native"}',
        cookies: [],
      });

      const result = await executeRequest({
        tab: {
          id: "test-1",
          name: "Test",
          method: "GET",
          url: "https://api.example.com/data",
          endpoint: "/data",
          headers: [],
          queryParams: [],
          pathParams: [],
          body: "",
          bodyType: "json",
          authType: "none",
          authToken: "",
          hasResponse: false,
          isSaved: false,
        },
        allVars: [],
        activeProjectPort: 3000,
        activeProject: false,
        nativeMode: true,
        activeWorkspaceId: null,
      });

      expect(result.responseStatus).toBe(200);
      expect(result.responseBody).toBe('{"data": "native"}');
      expect(tauriModule.invokeTauriFetch).toHaveBeenCalled();
    });

    it("handles network errors", async () => {
      vi.mocked(global.fetch).mockRejectedValue(new Error("Network failure"));

      const result = await executeRequest({
        tab: {
          id: "test-1",
          name: "Test",
          method: "GET",
          url: "https://api.example.com/data",
          endpoint: "/data",
          headers: [],
          queryParams: [],
          pathParams: [],
          body: "",
          bodyType: "json",
          authType: "none",
          authToken: "",
          hasResponse: false,
          isSaved: false,
        },
        allVars: [],
        activeProjectPort: 3000,
        activeProject: false,
        nativeMode: false,
        activeWorkspaceId: null,
      });

      expect(result.responseBody).toBe("");
      expect(result.responseStatus).toBe(0);
      expect(result.transportError?.detail).toContain("Network failure");
    });

    it("executes even when restored tab has undefined authToken/header fields", async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status: 200, body: "{}", headers: {} }),
      } as unknown as Response);

      const result = await executeRequest({
        tab: {
          id: "restored-1",
          name: "Restored",
          method: "GET",
          url: "https://api.example.com/data",
          endpoint: "/data",
          headers: [{ key: "Accept", value: "application/json" }],
          queryParams: [{ key: "page", value: "1" }],
          pathParams: [],
          body: "",
          bodyType: "json",
          authType: "none",
          authToken: undefined as never,
          hasResponse: false,
          isSaved: false,
        },
        allVars: [],
        activeProjectPort: 3000,
        activeProject: false,
        nativeMode: false,
        activeWorkspaceId: null,
      });

      expect(result.responseStatus).toBe(200);
      expect(global.fetch).toHaveBeenCalledWith("/api/proxy", expect.anything());
    });

    it("sends JSON body for POST via proxy", async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ status: 201, body: '{"id": 123}', headers: {} }),
      } as unknown as Response);

      await executeRequest({
        tab: {
          id: "test-1",
          name: "Test",
          method: "POST",
          url: "https://api.example.com/items",
          endpoint: "/items",
          headers: [],
          queryParams: [],
          pathParams: [],
          body: '{"name": "Test"}',
          bodyType: "json",
          authType: "none",
          authToken: "",
          hasResponse: false,
          isSaved: false,
        },
        allVars: [],
        activeProjectPort: 3000,
        activeProject: false,
        nativeMode: false,
        activeWorkspaceId: null,
      });

      // Vérifie que le proxy reçoit le body JSON (objet sérialisé avec url, method, headers, body, workspaceId)
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/proxy",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"url":"https://api.example.com/items"'),
        }),
      );
    });
  });

  describe("proxy error translation", () => {
    const baseTab = {
      id: "test-1",
      name: "Test",
      method: "GET" as const,
      url: "http://localhost:3000/api",
      endpoint: "/api",
      headers: [] as never[],
      queryParams: [],
      pathParams: [],
      body: "",
      bodyType: "json" as const,
      authType: "none" as const,
      authToken: "",
      hasResponse: false,
      isSaved: false,
    };

    async function executeWithProxyError(code: string, errorText: string) {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
        text: () => Promise.resolve(JSON.stringify({ error: errorText, code })),
      } as unknown as Response);
      const { parseJsonSafe } = await import("../utils");
      vi.mocked(parseJsonSafe).mockResolvedValue({
        status: 502,
        error: errorText,
        code,
      } as unknown as Awaited<ReturnType<typeof parseJsonSafe>>);

      return executeRequest({
        tab: baseTab,
        allVars: [],
        activeProjectPort: 3000,
        activeProject: false,
        nativeMode: false,
        activeWorkspaceId: null,
      });
    }

    it("expects SSRF_BLOCKED from the proxy (not BLOCKED_SSRF) and suggests local-host escape hatch", async () => {
      const result = await executeWithProxyError(
        "SSRF_BLOCKED",
        "Requests to private/internal hosts are not allowed",
      );
      expect(result.transportError?.code).toBe("SSRF_BLOCKED");
      expect(result.responseBody).toContain("localhost");
    });

    it("maps TARGET_UNREACHABLE to an actionable message", async () => {
      const result = await executeWithProxyError(
        "TARGET_UNREACHABLE",
        "Target host unreachable: connect ECONNREFUSED 127.0.0.1:3000",
      );
      expect(result.transportError?.code).toBe("TARGET_UNREACHABLE");
      expect(result.responseBody).toContain("injoignable");
      expect(result.transportError?.detail).toContain("ECONNREFUSED");
    });

    it("maps CERTIFICATE_ERROR to an actionable message", async () => {
      const result = await executeWithProxyError(
        "CERTIFICATE_ERROR",
        "Upstream TLS certificate error: self signed certificate",
      );
      expect(result.transportError?.code).toBe("CERTIFICATE_ERROR");
      expect(result.responseBody).toContain("TLS");
    });

    it("keeps TIMEOUT mapped to the timeout message", async () => {
      const result = await executeWithProxyError("TIMEOUT", "Request timed out");
      expect(result.transportError?.code).toBe("TIMEOUT");
      expect(result.responseBody).toContain("expiré");
    });
  });
});

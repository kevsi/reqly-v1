import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRequestExecutionCore } from "../use-request-execution-core";
import { useRequestStore } from "../use-request-store";
import type { RequestTabsState } from "../use-request-tabs-state";
import type { RequestItem } from "@/lib/types";
import * as requestExecutor from "@/lib/request-executor";
import * as testRunnerScripts from "@/lib/test-runner/scripts";

vi.mock("../use-request-store");
vi.mock("@/lib/request-executor");
vi.mock("@/lib/test-runner/scripts");
vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
}));

describe("useRequestExecutionCore", () => {
  const mockUpdateTab = vi.fn();
  const mockState: RequestTabsState = {
    tabs: [],
    activeTabId: "tab-1",
    nativeMode: false,
    setTabs: vi.fn(),
    setActiveTabId: vi.fn(),
    addTab: vi.fn(),
    updateTab: mockUpdateTab,
    closeTab: vi.fn(),
    duplicateTab: vi.fn(),
    setLoadingCount: vi.fn(),
    saveActiveTab: vi.fn(),
    exportAllTabs: vi.fn(),
  };

  const mockStore = {
    environments: [
      {
        id: "env-1",
        name: "Test Env",
        variables: [{ key: "API_KEY", value: "secret123", enabled: true }],
      },
    ],
    activeEnvironmentId: "env-1",
    projects: [{ id: "proj-1", name: "Test Project", port: 8080, folderPath: "/test" }],
    selectedProjectId: "proj-1",
    history: [],
    addHistoryAndNotify: vi.fn(),
    variableMappings: [],
    setCurrentRequest: vi.fn(),
    setLastResponse: vi.fn(),
    activeWorkspaceId: "workspace-1",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useRequestStore).mockReturnValue(
      mockStore as unknown as ReturnType<typeof useRequestStore>,
    );
    vi.mocked(requestExecutor.executeRequest).mockResolvedValue({
      status: 200,
      statusText: "OK",
      responseHeaders: {},
      responseBody: '{"success": true}',
      responseTime: 123,
      responseSize: "15 B",
      responseStatus: 200,
      timings: { dns: 10, tcp: 20, tls: 30, ttfb: 50, download: 13 },
    } as unknown as Awaited<ReturnType<typeof requestExecutor.executeRequest>>);
    vi.mocked(testRunnerScripts.runScript).mockResolvedValue({
      error: null,
      consoleLines: [],
    });
  });

  it("builds tab from request with project port replacement", () => {
    const { result } = renderHook(() => useRequestExecutionCore(mockState));
    const tab = result.current.buildTabFromRequest({
      name: "Test Request",
      method: "GET",
      url: "http://localhost:3000/api",
      endpoint: "/api",
      headers: { "Content-Type": "application/json" },
      queryParams: [],
      body: "",
    } as unknown as RequestItem);

    expect(tab.url).toBe("http://localhost:8080/api");
    expect(tab.method).toBe("GET");
    expect(tab.name).toBe("Test Request");
  });

  it("sends request and updates tab with response", async () => {
    const { result } = renderHook(() => useRequestExecutionCore(mockState));
    const tab = {
      id: "tab-1",
      name: "Test",
      method: "GET" as const,
      url: "https://api.example.com",
      endpoint: "/",
      headers: [],
      queryParams: [],
      pathParams: [],
      body: "",
      bodyType: "json" as const,
      authType: "none" as const,
      authToken: "",
      hasResponse: false,
      isSaved: false,
    };

    await act(async () => {
      await result.current.sendSpecificRequest(tab, false);
    });

    // executeRequest should have been called
    expect(requestExecutor.executeRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        tab: expect.objectContaining({ url: "https://api.example.com" }),
        nativeMode: false,
        activeWorkspaceId: "workspace-1",
      }),
    );

    // updateTab should have been called with response
    expect(mockUpdateTab).toHaveBeenCalledWith(
      "tab-1",
      expect.objectContaining({
        hasResponse: true,
        responseStatus: 200,
        responseBody: '{"success": true}',
      }),
    );
  });

  it("interpolates environment variables in URL before sending", async () => {
    const { result } = renderHook(() => useRequestExecutionCore(mockState));
    const tab = {
      id: "tab-1",
      name: "Test",
      method: "GET" as const,
      url: "https://api.example.com?key={{API_KEY}}",
      endpoint: "/",
      headers: [],
      queryParams: [],
      pathParams: [],
      body: "",
      bodyType: "json" as const,
      authType: "none" as const,
      authToken: "",
      hasResponse: false,
      isSaved: false,
    };

    await act(async () => {
      await result.current.sendSpecificRequest(tab, false);
    });

    // Check that allVars contains API_KEY
    const call = vi.mocked(requestExecutor.executeRequest).mock.calls[0];
    expect(call[0].allVars).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "API_KEY", value: "secret123" })]),
    );
  });

  it("runs pre-request script before sending", async () => {
    vi.mocked(testRunnerScripts.runScript).mockResolvedValueOnce({
      error: null,
      consoleLines: ["Script executed"],
    });

    const { result } = renderHook(() => useRequestExecutionCore(mockState));
    const tab = {
      id: "tab-1",
      name: "Test",
      method: "POST" as const,
      url: "https://api.example.com",
      endpoint: "/",
      headers: [],
      queryParams: [],
      pathParams: [],
      body: '{"token": "{{API_KEY}}"}',
      bodyType: "json" as const,
      authType: "none" as const,
      authToken: "",
      hasResponse: false,
      isSaved: false,
      preRequestScript: 'ctx.environment.DYNAMIC = "value";',
    };

    await act(async () => {
      await result.current.sendSpecificRequest(tab, false);
    });

    expect(testRunnerScripts.runScript).toHaveBeenCalledWith(
      'ctx.environment.DYNAMIC = "value";',
      expect.objectContaining({
        environment: expect.objectContaining({ API_KEY: "secret123" }),
      }),
      expect.objectContaining({ phase: "pre", timeoutMs: 5000 }),
    );
  });

  it("handles missing URL gracefully", async () => {
    const { toast } = await import("@/hooks/use-toast");
    const { result } = renderHook(() => useRequestExecutionCore(mockState));
    const tab = {
      id: "tab-1",
      name: "Test",
      method: "GET" as const,
      url: "",
      endpoint: "/",
      headers: [],
      queryParams: [],
      pathParams: [],
      body: "",
      bodyType: "json" as const,
      authType: "none" as const,
      authToken: "",
      hasResponse: false,
      isSaved: false,
    };

    await act(async () => {
      await result.current.sendSpecificRequest(tab, false);
    });

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "URL manquante",
        variant: "destructive",
      }),
    );
    expect(mockUpdateTab).not.toHaveBeenCalled();
  });

  it("notifies when unresolved variables are present", async () => {
    const { toast } = await import("@/hooks/use-toast");
    const { result } = renderHook(() => useRequestExecutionCore(mockState));
    const tab = {
      id: "tab-1",
      name: "Test",
      method: "GET" as const,
      url: "https://api.example.com?token={{MISSING_VAR}}",
      endpoint: "/",
      headers: [],
      queryParams: [],
      pathParams: [],
      body: "",
      bodyType: "json" as const,
      authType: "none" as const,
      authToken: "",
      hasResponse: false,
      isSaved: false,
    };

    await act(async () => {
      await result.current.sendSpecificRequest(tab, false);
    });

    // Should have shown unresolved variables toast
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Variables non résolues",
        variant: "destructive",
      }),
    );
  });

  it("names unresolved placeholders with their field in the toast description", async () => {
    const { toast } = await import("@/hooks/use-toast");
    const { result } = renderHook(() => useRequestExecutionCore(mockState));
    const tab = {
      id: "tab-1",
      name: "Test",
      method: "GET" as const,
      url: "https://api.example.com?apiKey={{apiKey}}",
      endpoint: "/",
      headers: [
        { key: "Authorization", value: "Bearer {{MISSING_TOKEN}}", enabled: true },
        { key: "X-Disabled", value: "{{DISABLED_ONE}}", enabled: false },
      ],
      queryParams: [],
      pathParams: [],
      body: '{"refresh": "{{MISSING_REFRESH}}"}',
      bodyType: "json" as const,
      authType: "none" as const,
      authToken: "",
      hasResponse: false,
      isSaved: false,
    };

    await act(async () => {
      await result.current.sendSpecificRequest(tab, false);
    });

    expect(requestExecutor.executeRequest).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Variables non résolues",
        description: expect.stringContaining("apiKey (URL)"),
        variant: "destructive",
      }),
    );
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining("MISSING_TOKEN (header Authorization)"),
      }),
    );
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining("MISSING_REFRESH (body)"),
      }),
    );
    // Disabled headers are not interpolated by buildHeaders and must not block.
    expect(toast).toHaveBeenCalledWith(
      expect.not.objectContaining({
        description: expect.stringContaining("DISABLED_ONE"),
      }),
    );
  });

  it("blocks execution when a disabled environment variable is used in a header", async () => {
    vi.mocked(useRequestStore).mockReturnValue({
      ...mockStore,
      environments: [
        {
          id: "env-1",
          name: "Test Env",
          variables: [{ key: "API_KEY", value: "secret123", enabled: false }],
        },
      ],
      activeEnvironmentId: "env-1",
    } as unknown as ReturnType<typeof useRequestStore>);
    const { toast } = await import("@/hooks/use-toast");
    const { result } = renderHook(() => useRequestExecutionCore(mockState));
    const tab = {
      id: "tab-1",
      name: "Test",
      method: "GET" as const,
      url: "https://api.example.com",
      endpoint: "/",
      headers: [{ key: "x-api-key", value: "{{API_KEY}}", enabled: true }],
      queryParams: [],
      pathParams: [],
      body: "",
      bodyType: "json" as const,
      authType: "none" as const,
      authToken: "",
      hasResponse: false,
      isSaved: false,
    };

    await act(async () => {
      await result.current.sendSpecificRequest(tab, false);
    });

    expect(requestExecutor.executeRequest).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining("API_KEY (header x-api-key)"),
      }),
    );
  });
});

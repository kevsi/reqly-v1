import type { MockEndpoint, MockServerConfig, MockRequest } from "./types";

export class MockServerEngine {
  private endpoints: Map<string, MockEndpoint> = new Map();
  private requests: MockRequest[] = [];
  private config: MockServerConfig;
  private isRunning = false;

  constructor(config: MockServerConfig) {
    this.config = config;
  }

  addEndpoint(endpoint: MockEndpoint) {
    this.endpoints.set(endpoint.id, endpoint);
  }

  removeEndpoint(id: string) {
    this.endpoints.delete(id);
  }

  updateEndpoint(id: string, patch: Partial<MockEndpoint>) {
    const endpoint = this.endpoints.get(id);
    if (endpoint) {
      this.endpoints.set(id, { ...endpoint, ...patch });
    }
  }

  getEndpoints(): MockEndpoint[] {
    return Array.from(this.endpoints.values());
  }

  getRequests(): MockRequest[] {
    return this.requests;
  }

  clearRequests() {
    this.requests = [];
  }

  matchEndpoint(method: string, path: string): MockEndpoint | null {
    for (const endpoint of this.endpoints.values()) {
      if (!endpoint.enabled) continue;
      if (endpoint.method !== method) continue;

      // Exact match
      if (endpoint.path === path) return endpoint;

      // Pattern match (simple wildcard support)
      const pattern = endpoint.path.replace(/\*/g, ".*").replace(/:\w+/g, "[^/]+");
      const regex = new RegExp(`^${pattern}$`);
      if (regex.test(path)) return endpoint;
    }
    return null;
  }

  async handleRequest(
    method: string,
    path: string,
    headers: Record<string, string>,
    body?: string,
  ): Promise<{
    statusCode: number;
    headers: Record<string, string>;
    body: string;
  }> {
    const request: MockRequest = {
      id: `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      method,
      path,
      headers,
      body,
    };

    const endpoint = this.matchEndpoint(method, path);

    if (endpoint) {
      request.matchedEndpointId = endpoint.id;

      // Apply delay if configured
      if (endpoint.delay && endpoint.delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, endpoint.delay));
      }

      this.requests.push(request);

      const responseHeaders = { ...endpoint.headers };
      if (this.config.cors) {
        responseHeaders["Access-Control-Allow-Origin"] = "*";
        responseHeaders["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
        responseHeaders["Access-Control-Allow-Headers"] = "*";
      }

      return {
        statusCode: endpoint.statusCode,
        headers: responseHeaders,
        body: endpoint.body,
      };
    }

    // No match - return 404
    this.requests.push(request);
    return {
      statusCode: 404,
      headers: this.config.cors
        ? {
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "application/json",
          }
        : { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Endpoint not found", path, method }),
    };
  }

  start() {
    this.isRunning = true;
  }

  stop() {
    this.isRunning = false;
  }

  getStatus() {
    return {
      running: this.isRunning,
      endpointsCount: this.endpoints.size,
      requestsCount: this.requests.length,
      config: this.config,
    };
  }
}

export function createMockServerEngine(config: MockServerConfig): MockServerEngine {
  return new MockServerEngine(config);
}

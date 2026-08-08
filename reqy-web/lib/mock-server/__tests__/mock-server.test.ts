import { describe, it, expect, beforeEach } from "vitest";
import {
  MockServerEngine,
  createMockServerEngine,
  generateMockFromCapture,
} from "@/lib/mock-server";
import type { MockEndpoint, MockServerConfig } from "@/lib/mock-server";

describe("MockServerEngine", () => {
  let engine: MockServerEngine;
  const config: MockServerConfig = {
    port: 8090,
    cors: true,
    logRequests: true,
  };

  beforeEach(() => {
    engine = createMockServerEngine(config);
  });

  describe("endpoint management", () => {
    it("adds endpoint correctly", () => {
      const endpoint: MockEndpoint = {
        id: "test-1",
        name: "Test Endpoint",
        method: "GET",
        path: "/api/test",
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: '{"success": true}',
        enabled: true,
        createdAt: new Date().toISOString(),
      };

      engine.addEndpoint(endpoint);
      const endpoints = engine.getEndpoints();

      expect(endpoints).toHaveLength(1);
      expect(endpoints[0]).toEqual(endpoint);
    });

    it("removes endpoint correctly", () => {
      const endpoint: MockEndpoint = {
        id: "test-1",
        name: "Test",
        method: "GET",
        path: "/test",
        statusCode: 200,
        headers: {},
        body: "",
        enabled: true,
        createdAt: new Date().toISOString(),
      };

      engine.addEndpoint(endpoint);
      expect(engine.getEndpoints()).toHaveLength(1);

      engine.removeEndpoint("test-1");
      expect(engine.getEndpoints()).toHaveLength(0);
    });

    it("updates endpoint correctly", () => {
      const endpoint: MockEndpoint = {
        id: "test-1",
        name: "Test",
        method: "GET",
        path: "/test",
        statusCode: 200,
        headers: {},
        body: "",
        enabled: true,
        createdAt: new Date().toISOString(),
      };

      engine.addEndpoint(endpoint);
      engine.updateEndpoint("test-1", { statusCode: 404, enabled: false });

      const updated = engine.getEndpoints()[0];
      expect(updated.statusCode).toBe(404);
      expect(updated.enabled).toBe(false);
    });
  });

  describe("endpoint matching", () => {
    beforeEach(() => {
      engine.addEndpoint({
        id: "exact-1",
        name: "Exact Match",
        method: "GET",
        path: "/api/users",
        statusCode: 200,
        headers: {},
        body: "[]",
        enabled: true,
        createdAt: new Date().toISOString(),
      });

      engine.addEndpoint({
        id: "param-1",
        name: "With Param",
        method: "GET",
        path: "/api/users/:id",
        statusCode: 200,
        headers: {},
        body: '{"id": 1}',
        enabled: true,
        createdAt: new Date().toISOString(),
      });

      engine.addEndpoint({
        id: "wildcard-1",
        name: "Wildcard",
        method: "GET",
        path: "/api/posts/*",
        statusCode: 200,
        headers: {},
        body: '{"posts": []}',
        enabled: true,
        createdAt: new Date().toISOString(),
      });

      engine.addEndpoint({
        id: "disabled-1",
        name: "Disabled",
        method: "GET",
        path: "/api/disabled",
        statusCode: 200,
        headers: {},
        body: "",
        enabled: false,
        createdAt: new Date().toISOString(),
      });
    });

    it("matches exact path", () => {
      const match = engine.matchEndpoint("GET", "/api/users");
      expect(match).not.toBeNull();
      expect(match?.id).toBe("exact-1");
    });

    it("matches path with parameter", () => {
      const match = engine.matchEndpoint("GET", "/api/users/123");
      expect(match).not.toBeNull();
      expect(match?.id).toBe("param-1");
    });

    it("matches wildcard path", () => {
      const match = engine.matchEndpoint("GET", "/api/posts/2024/january");
      expect(match).not.toBeNull();
      expect(match?.id).toBe("wildcard-1");
    });

    it("does not match disabled endpoint", () => {
      const match = engine.matchEndpoint("GET", "/api/disabled");
      expect(match).toBeNull();
    });

    it("does not match wrong method", () => {
      const match = engine.matchEndpoint("POST", "/api/users");
      expect(match).toBeNull();
    });

    it("returns null for non-existent path", () => {
      const match = engine.matchEndpoint("GET", "/api/nonexistent");
      expect(match).toBeNull();
    });
  });

  describe("request handling", () => {
    beforeEach(() => {
      engine.addEndpoint({
        id: "test-1",
        name: "Test",
        method: "GET",
        path: "/api/test",
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: '{"result": "success"}',
        enabled: true,
        createdAt: new Date().toISOString(),
      });
    });

    it("handles matched request correctly", async () => {
      const response = await engine.handleRequest("GET", "/api/test", {});

      expect(response.statusCode).toBe(200);
      expect(response.headers["Content-Type"]).toBe("application/json");
      expect(response.body).toBe('{"result": "success"}');
      expect(response.headers["Access-Control-Allow-Origin"]).toBe("*");
    });

    it("handles unmatched request with 404", async () => {
      const response = await engine.handleRequest("GET", "/api/notfound", {});

      expect(response.statusCode).toBe(404);
      expect(response.body).toContain("Endpoint not found");
    });

    it("logs requests when enabled", async () => {
      await engine.handleRequest("GET", "/api/test", {});
      const requests = engine.getRequests();

      expect(requests).toHaveLength(1);
      expect(requests[0].method).toBe("GET");
      expect(requests[0].path).toBe("/api/test");
      expect(requests[0].matchedEndpointId).toBe("test-1");
    });

    it("applies delay when configured", async () => {
      engine.addEndpoint({
        id: "delayed-1",
        name: "Delayed",
        method: "GET",
        path: "/api/delayed",
        statusCode: 200,
        headers: {},
        body: "",
        delay: 100,
        enabled: true,
        createdAt: new Date().toISOString(),
      });

      const start = Date.now();
      await engine.handleRequest("GET", "/api/delayed", {});
      const duration = Date.now() - start;

      expect(duration).toBeGreaterThanOrEqual(95); // Allow 5ms margin
    });

    it("clears request log", async () => {
      await engine.handleRequest("GET", "/api/test", {});
      expect(engine.getRequests()).toHaveLength(1);

      engine.clearRequests();
      expect(engine.getRequests()).toHaveLength(0);
    });
  });

  describe("server status", () => {
    it("starts and stops correctly", () => {
      expect(engine.getStatus().running).toBe(false);

      engine.start();
      expect(engine.getStatus().running).toBe(true);

      engine.stop();
      expect(engine.getStatus().running).toBe(false);
    });

    it("reports correct status", () => {
      engine.addEndpoint({
        id: "test-1",
        name: "Test",
        method: "GET",
        path: "/test",
        statusCode: 200,
        headers: {},
        body: "",
        enabled: true,
        createdAt: new Date().toISOString(),
      });

      const status = engine.getStatus();
      expect(status.endpointsCount).toBe(1);
      expect(status.requestsCount).toBe(0);
      expect(status.config).toEqual(config);
    });
  });
});

describe("generateMockFromCapture", () => {
  it("generates mock endpoint from captured request", () => {
    const capture = {
      id: "cap-1",
      method: "GET",
      url: "https://api.example.com/users/123",
      requestHeaders: {},
      requestBody: null,
      responseStatus: 200,
      responseHeaders: { "Content-Type": "application/json" },
      responseBody: '{"id": 123, "name": "John"}',
      timestamp: new Date().toISOString(),
    };

    const mock = generateMockFromCapture(capture);

    expect(mock.method).toBe("GET");
    expect(mock.path).toBe("/users/123");
    expect(mock.statusCode).toBe(200);
    expect(mock.body).toBe('{"id": 123, "name": "John"}');
    expect(mock.source).toBe("capture");
    expect(mock.enabled).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { buildMcpClientConfig } from "@/lib/mcp/config";

describe("buildMcpClientConfig", () => {
  it("builds a Claude Desktop config pointing at the local MCP port", () => {
    const cfg = buildMcpClientConfig("claude-desktop", { port: 3311 });
    const parsed = JSON.parse(cfg);
    expect(parsed.mcpServers.reqly.command).toBe("npx");
    expect(parsed.mcpServers.reqly.args).toContain("http://127.0.0.1:3311/mcp");
  });

  it("builds a Cursor config pointing at the local MCP url", () => {
    const cfg = buildMcpClientConfig("cursor", { port: 3311 });
    const parsed = JSON.parse(cfg);
    expect(parsed.mcpServers.reqly.url).toBe("http://127.0.0.1:3311/mcp");
  });

  it("builds a generic config returning url and name", () => {
    const cfg = buildMcpClientConfig("generic", { port: 3311, name: "reqly" });
    const parsed = JSON.parse(cfg);
    expect(parsed.url).toBe("http://127.0.0.1:3311/mcp");
    expect(parsed.name).toBe("reqly");
  });

  it("falls back to default port 3311 and name reqly", () => {
    const cfg = buildMcpClientConfig("claude-desktop");
    const parsed = JSON.parse(cfg);
    expect(parsed.mcpServers.reqly.args).toContain("http://127.0.0.1:3311/mcp");
    expect(parsed.mcpServers.reqly).toBeDefined();
  });

  it("honours a custom port", () => {
    const cfg = buildMcpClientConfig("cursor", { port: 8080 });
    const parsed = JSON.parse(cfg);
    expect(parsed.mcpServers.reqly.url).toBe("http://127.0.0.1:8080/mcp");
  });
});

export type McpTarget = "claude-desktop" | "cursor" | "generic";

export function buildMcpClientConfig(
  target: McpTarget,
  opts: { port?: number; name?: string } = {},
): string {
  const port = opts.port ?? 3311;
  const name = opts.name ?? "reqly";
  const url = `http://127.0.0.1:${port}/mcp`;

  if (target === "claude-desktop") {
    return JSON.stringify(
      { mcpServers: { [name]: { command: "npx", args: ["-y", "mcp-remote", url] } } },
      null,
      2,
    );
  }
  if (target === "cursor") {
    return JSON.stringify({ mcpServers: { [name]: { url } } }, null, 2);
  }
  return JSON.stringify({ url, name }, null, 2);
}

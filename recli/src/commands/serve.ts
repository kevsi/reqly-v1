import fs from "node:fs";
import path from "node:path";
import { program, Command } from "commander";
import { startMcpServer } from "../mcp/server.js";

export function registerServe(program: Command): void {
  program
    .command("serve")
    .description("Start the Reqly MCP server for AI agent integration")
    .option("--file <path>", "Path to exported Reqly JSON bundle")
    .option("--port <number>", "Port for HTTP transport (default: stdio)")
    .option("--env <name>", "Default environment name for variable interpolation")
    .option("--timeout <ms>", "Default request timeout in milliseconds", "30000")
    .option("--allow-local-hosts", "Allow requests to private/local addresses (disabled by default)")
    .option("--max-response-size <bytes>", "Maximum response body size in bytes", "10485760")
    .option(
      "--cors-origins <origins>",
      "Comma-separated allowed CORS origins for HTTP transport",
      "http://127.0.0.1,http://localhost",
    )
    .action(async (opts) => {
      const timeout = parseInt(opts.timeout, 10) || 30000;
      const maxResponseSize = parseInt(opts.maxResponseSize, 10) || 10 * 1024 * 1024;
      const port = opts.port ? parseInt(opts.port, 10) : undefined;
      const allowLocalHosts = opts.allowLocalHosts === true;
      const corsOrigins = opts.corsOrigins
        .split(",")
        .map((o: string) => o.trim().toLowerCase())
        .filter(Boolean);

      let bundle;
      let bundlePath;

      if (opts.file) {
        const resolvedPath = path.resolve(opts.file);
        if (!fs.existsSync(resolvedPath)) {
          process.stderr.write(`File not found: ${resolvedPath}\n`);
          process.exit(1);
        }
        const content = fs.readFileSync(resolvedPath, "utf8");
        bundle = JSON.parse(content);
        bundlePath = resolvedPath;
      }

      try {
        await startMcpServer({
          bundle,
          bundlePath,
          env: opts.env,
          timeout,
          port,
          allowLocalHosts,
          maxResponseSize,
          corsOrigins,
        });
      } catch (err: unknown) {
        process.stderr.write(`MCP server error: ${err instanceof Error ? err.message : String(err)}\n`);
        process.exit(1);
      }
    });
}

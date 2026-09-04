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
    .option(
      "--allow-local-hosts",
      "Allow requests to private/local addresses (disabled by default)",
    )
    .option(
      "--token <token>",
      "Require Authorization: Bearer <token> on every HTTP request (remote clients)",
    )
    .option("--max-response-size <bytes>", "Maximum response body size in bytes", "10485760")
    .option(
      "--cors-origins <origins>",
      "Comma-separated allowed CORS origins for HTTP transport",
      "http://127.0.0.1,http://localhost",
    )
    .option("--tls-cert <path>", "Path to server TLS certificate (enables HTTPS)")
    .option("--tls-key <path>", "Path to server TLS private key (required with --tls-cert)")
    .option(
      "--tls-ca <path>",
      "Path to CA certificate to verify client certs (enables mTLS when used with --tls-cert/--tls-key)",
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
        const tlsCert = opts.tlsCert ? path.resolve(opts.tlsCert) : undefined;
        const tlsKey = opts.tlsKey ? path.resolve(opts.tlsKey) : undefined;
        const tlsCa = opts.tlsCa ? path.resolve(opts.tlsCa) : undefined;

        if (tlsCert && !tlsKey) {
          process.stderr.write("--tls-key is required when --tls-cert is provided\n");
          process.exit(1);
        }
        if (tlsKey && !tlsCert) {
          process.stderr.write("--tls-cert is required when --tls-key is provided\n");
          process.exit(1);
        }

        // SECURITY (audit 2026-09-04): en mode sidecar Tauri (pas de TTY), le
        // token arrive par STDIN — un token en argv est lisible par tout
        // processus local via la liste des process.
        let authToken = opts.token;
        if (!authToken && !process.stdin.isTTY) {
          authToken = await readStdinToken();
        }

        await startMcpServer({
          bundle,
          bundlePath,
          env: opts.env,
          timeout,
          port,
          allowLocalHosts,
          maxResponseSize,
          corsOrigins,
          authToken,
          tlsCert,
          tlsKey,
          tlsCa,
        });
      } catch (err: unknown) {
        process.stderr.write(
          `MCP server error: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        process.exit(1);
      }
    });
}

/** Lit un token sur stdin (une ligne, jusqu'a EOF) — mode sidecar Tauri. */
async function readStdinToken(): Promise<string | undefined> {
  return new Promise((resolve) => {
    let data = "";
    const timer = setTimeout(() => resolve(undefined), 5000);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      data += chunk;
      if (data.includes("\n")) {
        clearTimeout(timer);
        const firstLine = data.split("\n")[0].trim();
        resolve(firstLine || undefined);
      }
    });
    process.stdin.on("end", () => {
      clearTimeout(timer);
      resolve(data.trim() || undefined);
    });
  });
}

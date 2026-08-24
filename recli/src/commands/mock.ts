import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import chalk from "chalk";
import yaml from "js-yaml";
import {
  createMockServer,
  EXAMPLE_MOCK_CONFIG,
  MOCK_CONFIG_VERSION,
  type MockConfig,
} from "@reqly/mock-engine";

/** Load a mock config file (JSON or YAML) with light validation. */
export function loadMockConfigFile(filePath: string): MockConfig {
  const raw = fs.readFileSync(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = filePath.endsWith(".json") ? JSON.parse(raw) : (yaml.load(raw) as unknown);
  } catch (err) {
    throw new Error(
      `Invalid mock config (${filePath}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  assertConfig(parsed, filePath);
  return parsed as MockConfig;
}

function assertConfig(value: unknown, source: string): void {
  const cfg = value as MockConfig | undefined;
  if (!cfg || typeof cfg !== "object") throw new Error(`Mock config is empty: ${source}`);
  if (cfg.version !== MOCK_CONFIG_VERSION)
    throw new Error(
      `Unsupported mock config version ${String(cfg.version)} (expected ${MOCK_CONFIG_VERSION}) in ${source}`,
    );
  if (!Array.isArray(cfg.routes)) throw new Error(`Mock config must contain routes[]: ${source}`);
  for (const route of cfg.routes) {
    if (!route.id || !route.method || !route.path || !Array.isArray(route.responses)) {
      throw new Error(
        `Route entries need id/method/path/responses — check route "${route.id ?? "?"}" in ${source}`,
      );
    }
  }
}

export function registerMock(program: Command): void {
  const mock = program
    .command("mock")
    .description("Run a local mock server from a versionable config file");

  mock
    .command("start")
    .description("Start the mock server (`recli mock start mock.config.json`)")
    .argument("[file]", "Path to the mock config (JSON or YAML)", "mock.config.json")
    .option("--port <number>", "Override the port from the config", parseInt)
    .option("--host <host>", "Override the bind host from the config")
    .option("--base-path <prefix>", "Strip this prefix before matching")
    .option("--watch", "Hot-reload the config on file change", false)
    .option(
      "--admin-token [token]",
      "Enable the /mock/__admin control channel (auto-generates a token when omitted)",
    )
    .option(
      "--allow-admin-expose",
      "Allow the admin channel on a non-loopback host (explicit opt-in)",
      false,
    )
    .action(
      async (
        file: string,
        opts: {
          port?: number;
          host?: string;
          basePath?: string;
          watch?: boolean;
          adminToken?: string | true;
          allowAdminExpose?: boolean;
        },
      ) => {
        const resolved = path.resolve(file);
        if (!fs.existsSync(resolved)) {
          console.error(chalk.red(`Mock config not found: ${resolved}`));
          console.error(chalk.gray(`Run \`recli mock init\` to scaffold one.`));
          process.exitCode = 1;
          return;
        }

        let config = loadMockConfigFile(resolved);
        if (opts.port !== undefined) config = { ...config, port: opts.port };
        if (opts.host !== undefined) config = { ...config, host: opts.host };
        if (opts.basePath !== undefined) config = { ...config, basePath: opts.basePath };

        // Admin channel: absent flag = disabled; bare flag or empty value = auto token.
        let adminToken: string | undefined;
        if (opts.adminToken !== undefined) {
          adminToken =
            typeof opts.adminToken === "string" && opts.adminToken.length > 0
              ? opts.adminToken
              : Array.from({ length: 24 }, () => Math.floor(Math.random() * 16).toString(16)).join(
                  "",
                );
        }
        const bindHost = config.host ?? "127.0.0.1";
        const loopback = ["127.0.0.1", "localhost", "::1"].includes(bindHost);
        if (adminToken && !loopback && !opts.allowAdminExpose) {
          console.error(chalk.red("Refusing to expose the admin channel on a non-loopback host."));
          console.error(chalk.gray("Re-run with --allow-admin-expose if you really mean it."));
          process.exitCode = 1;
          return;
        }

        const handle = createMockServer(config, {
          adminToken,
          onRequest: (r) => {
            const status =
              r.responseStatus === null
                ? chalk.red("ERR ")
                : r.responseStatus < 300
                  ? chalk.green(String(r.responseStatus).padEnd(3))
                  : r.responseStatus < 500
                    ? chalk.yellow(String(r.responseStatus).padEnd(3))
                    : chalk.red(String(r.responseStatus).padEnd(3));
            const routeTag = r.matchedRouteId ? chalk.gray(` [${r.matchedRouteId}]`) : "";
            console.log(
              `${chalk.gray(new Date(r.at).toLocaleTimeString())} ${status} ${chalk.bold(r.method)} ${r.url}${routeTag} ${chalk.gray(`${r.durationMs}ms`)}${r.note ? chalk.magenta(` (${r.note})`) : ""}`,
            );
          },
        });

        await new Promise<void>((resolve, reject) => {
          handle.server.once("error", reject);
          handle.server.listen(config.port ?? 4015, config.host ?? "127.0.0.1", resolve);
        });

        console.log(chalk.green(`▲ reqly mock serving ${config.routes.length} routes`));
        console.log(chalk.gray(`  → http://${config.host ?? "127.0.0.1"}:${handle.port()}`));
        console.log(
          chalk.gray(`  config: ${resolved}${opts.watch ? chalk.cyan("  (watching)") : ""}`),
        );
        console.log(chalk.gray(`  reset state: POST /mock/reset · stop: Ctrl+C`));

        let watcher: import("node:fs").FSWatcher | undefined;
        if (opts.watch) {
          let reloadTimer: NodeJS.Timeout | null = null;
          watcher = fs.watch(resolved, () => {
            if (reloadTimer) clearTimeout(reloadTimer);
            reloadTimer = setTimeout(() => {
              try {
                handle.replaceConfig(loadMockConfigFile(resolved));
                console.log(chalk.cyan("↻ mock config reloaded"));
              } catch (err) {
                console.error(
                  chalk.red(`✗ reload failed: ${err instanceof Error ? err.message : String(err)}`),
                );
              }
            }, 120);
          });
        }

        const shutdown = async () => {
          watcher?.close();
          await handle.close();
          process.exit(0);
        };
        process.on("SIGINT", () => void shutdown());
        process.on("SIGTERM", () => void shutdown());
      },
    );

  mock
    .command("init")
    .description("Scaffold a ready-to-run mock.config.json next to you")
    .argument("[file]", "Target file to write", "mock.config.json")
    .option("--force", "Overwrite an existing file", false)
    .action((file: string, opts: { force?: boolean }) => {
      const resolved = path.resolve(file);
      if (!opts.force && fs.existsSync(resolved)) {
        console.error(chalk.red(`${resolved} already exists (use --force to overwrite)`));
        process.exitCode = 1;
        return;
      }
      fs.writeFileSync(resolved, JSON.stringify(EXAMPLE_MOCK_CONFIG, null, 2) + "\n");
      console.log(chalk.green(`✓ wrote ${resolved}`));
      console.log(chalk.gray(`Next: recli mock start ${path.basename(resolved)}`));
    });
}

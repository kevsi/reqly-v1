/**
 * `recli validate <file>` — validate an exported JSON collection file.
 *
 * Also handles `init [name]`, `export <file>` and `watch <file>` since they
 * are short file-manipulation commands that fit thematically.
 */

import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";

import { validateExportBundle } from "../validator.js";
import { flattenRequests } from "../runner.js";
import { printError } from "../reporters.js";
import { chalk, toCurl } from "../utils.js";
import type { ExportBundle } from "../utils.js";

export function registerValidate(program: Command): void {
  program
    .command("validate <file>")
    .description("Validate the format of an exported JSON file")
    .action((filePath: string) => {
      const resolvedPath = path.resolve(filePath);
      if (!fs.existsSync(resolvedPath)) {
        printError(`File not found: ${resolvedPath}`);
        process.exit(1);
      }

      let bundle: unknown;
      try {
        bundle = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
      } catch (e) {
        printError(e instanceof Error ? e.message : String(e));
        process.exit(1);
      }

      const errors = validateExportBundle(bundle);
      if (errors.length === 0) {
        console.log(chalk.green("Valid export bundle"));
        process.exit(0);
      } else {
        for (const err of errors) printError(`  - ${err.path}: ${err.message}`);
        process.exit(1);
      }
    });
}

export function registerInit(program: Command): void {
  program
    .command("init [name]")
    .description("Scaffold a new collection")
    .option("--graphql", "Create a GraphQL collection template")
    .action((name?: string, cmdOpts?: { graphql?: boolean }) => {
      const collectionName = name || "My Collection";
      const bundle: ExportBundle = {
        version: "1.0",
        exportedAt: new Date().toISOString(),
        collections: [
          {
            name: collectionName,
            requests: cmdOpts?.graphql
              ? [
                  {
                    name: "Sample GraphQL Query",
                    method: "GRAPHQL",
                    url: "https://api.example.com/graphql",
                    endpoint: "/graphql",
                    bodyType: "graphql",
                    graphql: { query: "query { users { id name } }" },
                  },
                ]
              : [
                  {
                    name: "Sample GET",
                    method: "GET",
                    url: "https://jsonplaceholder.typicode.com/posts/1",
                    endpoint: "/posts/1",
                  },
                ],
          },
        ],
      };
      const fileName = collectionName.toLowerCase().replace(/\s+/g, "-") + ".json";
      fs.writeFileSync(fileName, JSON.stringify(bundle, null, 2), "utf8");
      console.log(chalk.green(`Created: ${fileName}`));
    });
}

export function registerExport(program: Command): void {
  program
    .command("export <file>")
    .description("Export collection to curl commands")
    .action((filePath: string) => {
      const resolvedPath = path.resolve(filePath);
      if (!fs.existsSync(resolvedPath)) {
        printError(`File not found: ${resolvedPath}`);
        process.exit(1);
      }
      try {
        const bundle = JSON.parse(fs.readFileSync(resolvedPath, "utf8")) as ExportBundle;
        for (const req of flattenRequests(bundle)) {
          console.log(`# ${req.name} (${req.method} ${req.url})`);
          console.log(toCurl(req));
          console.log();
        }
      } catch (e) {
        printError(e instanceof Error ? e.message : String(e));
        process.exit(1);
      }
    });
}

export function registerWatch(program: Command): void {
  program
    .command("watch <file>")
    .description("Watch collection file and re-run on changes")
    .action(async (filePath: string) => {
      const { watch } = await import("chokidar");
      const { resolveOpts, chalk } = await import("../utils.js");
      const { runCollection } = await import("../runner.js");
      const { reportCLI, printError } = await import("../reporters.js");

      const resolvedPath = path.resolve(filePath);
      console.log(chalk.cyan(`Watching ${resolvedPath}...`));
      let running = false;

      const watcher = watch(resolvedPath, { persistent: true });

      const cleanup = () => {
        watcher.close();
        process.exit(0);
      };
      process.on("SIGINT", cleanup);
      process.on("SIGTERM", cleanup);

      watcher.on("change", async () => {
        if (running) return;
        running = true;
        console.clear();
        console.log(chalk.cyan(`\nFile changed. Re-running...\n`));
        try {
          const bundle = JSON.parse(fs.readFileSync(resolvedPath, "utf8")) as ExportBundle;
          const opts = resolveOpts(program);
          const results = await runCollection(bundle, {
            envName: opts.env,
            timeoutMs: parseInt(opts.timeout, 10) || 30000,
            noColor: !opts.color,
            parallel: !!opts.parallel,
            delayMs: opts.delay,
            reporter: opts.reporter,
          });
          reportCLI(results);
          const failed = results.filter((r) => !r.passed).length;
          const passed = results.length - failed;
          console.log(
            `\n${chalk.green(`${passed} passed`)}${failed > 0 ? chalk.red(`, ${failed} failed`) : ""}`,
          );
        } catch (e) {
          printError(e instanceof Error ? e.message : String(e));
        }
        running = false;
      });
      await new Promise(() => {});
    });
}

/**
 * `recli openapi <file>` — import an OpenAPI spec and optionally run it.
 */

import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";

import { runCollection } from "../runner.js";
import { importOpenAPI } from "../openapi.js";
import { printError } from "../reporters.js";
import { resolveOpts, emitResults, countRequests, chalk } from "../utils.js";

export function registerOpenApi(program: Command): void {
  program
    .command("openapi <file>")
    .description("Import an OpenAPI spec and generate requests")
    .option("--run", "Run the imported collection immediately")
    .option("--output <path>", "Write the generated collection JSON to file")
    .action(async (filePath: string, cmdOpts: { run?: boolean; output?: string }) => {
      const resolvedPath = path.resolve(filePath);
      if (!fs.existsSync(resolvedPath)) {
        printError(`File not found: ${resolvedPath}`);
        process.exit(1);
      }

      try {
        const content = fs.readFileSync(resolvedPath, "utf8");
        const bundle = importOpenAPI(content);
        const outputPath = cmdOpts.output || resolvedPath.replace(/\.\w+$/, "") + "-recli.json";
        fs.writeFileSync(outputPath, JSON.stringify(bundle, null, 2), "utf8");
        console.log(chalk.green(`Generated: ${outputPath} (${countRequests(bundle)} requests)`));

        if (cmdOpts.run) {
          const opts = resolveOpts(program);
          const timeoutMs = parseInt(opts.timeout, 10) || 30000;
          console.log(chalk.cyan("\nRunning...\n"));
          const results = await runCollection(bundle, {
            envName: opts.env,
            timeoutMs,
            noColor: !opts.color,
            json: !!opts.json,
            parallel: !!opts.parallel,
            delayMs: opts.delay,
            reporter: opts.reporter,
            output: opts.output,
          });
          await emitResults(results, opts);
          if (results.filter((r) => !r.passed).length > 0) process.exit(1);
        }
      } catch (e) {
        printError(e instanceof Error ? e.message : String(e));
        process.exit(1);
      }
    });
}

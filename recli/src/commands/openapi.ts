import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";

import { runCollection } from "../runner.js";
import { importOpenAPI } from "../openapi.js";
import { printError } from "../reporters.js";
import { resolveOpts, emitResults, countRequests, chalk } from "../utils.js";
import { diffSpecs } from "../spec-diff.js";

async function fetchSpec(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
}

export function registerOpenApi(program: Command): void {
  const cmd = program
    .command("openapi [file]")
    .description("Import an OpenAPI spec and generate requests")
    .option("--run", "Run the imported collection immediately")
    .option("--output <path>", "Write the generated collection JSON to file")
    .option(
      "--from-url <url>",
      "Fetch spec from a live server URL (e.g. http://localhost:4000/openapi.json)",
    )
    .option("--diff <b>", "Compare two specs: this file (or --from-url) vs <b>")
    .action(async (file: string | undefined, cmdOpts: Record<string, unknown>) => {
      const fromUrl = cmdOpts.fromUrl as string | undefined;
      const diffB = cmdOpts.diff as string | undefined;

      try {
        // --diff mode: compare two specs
        if (diffB) {
          if (!file && !fromUrl) {
            printError("--diff requires a spec argument (file or --from-url)");
            process.exit(1);
          }
          const contentA = file
            ? fs.readFileSync(path.resolve(file), "utf8")
            : await fetchSpec(fromUrl!);
          const contentB = fs.existsSync(path.resolve(diffB))
            ? fs.readFileSync(path.resolve(diffB), "utf8")
            : await fetchSpec(diffB);
          const diff = diffSpecs(contentA, contentB);
          console.log(chalk.bold(`\nSpec diff:`));
          console.log(
            `  ${chalk.green(`+${diff.added.length}`)} added, ${chalk.red(`-${diff.removed.length}`)} removed, ${chalk.yellow(`~${diff.changed.length}`)} changed`,
          );

          for (const e of diff.added)
            console.log(chalk.green(`  + ${e.method.toUpperCase()} ${e.path}`));
          for (const e of diff.removed)
            console.log(chalk.red(`  - ${e.method.toUpperCase()} ${e.path}`));
          for (const e of diff.changed) {
            console.log(chalk.yellow(`  ~ ${e.method.toUpperCase()} ${e.path}`));
            for (const c of e.changes) console.log(`      ${c}`);
          }

          if (diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0) {
            console.log(chalk.green("  (no differences)"));
          }
          return;
        }

        // Resolve spec content: from file or --from-url
        let content: string;
        let sourceName: string;

        if (fromUrl) {
          content = await fetchSpec(fromUrl);
          sourceName = fromUrl;
        } else if (file) {
          const resolved = path.resolve(file);
          if (!fs.existsSync(resolved)) {
            printError(`File not found: ${resolved}`);
            process.exit(1);
          }
          content = fs.readFileSync(resolved, "utf8");
          sourceName = resolved;
        } else {
          printError("Specify a spec file or use --from-url <url>");
          process.exit(1);
        }

        const bundle = importOpenAPI(content);
        const outputPath = cmdOpts.output
          ? (cmdOpts.output as string)
          : sourceName.replace(/\.\w+$/, "") + "-recli.json";
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

  // keep the subcommand-style help
  cmd;
}

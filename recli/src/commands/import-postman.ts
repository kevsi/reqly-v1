/**
 * `recli import-postman <file>` — convert a Postman collection (v2.0/v2.1)
 * into a recli bundle. The result is a valid input for `run`, `ui`, `validate`.
 */

import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { importPostmanCollection, parsePostmanEnvironment } from "../postman-import.js";
import { printError } from "../reporters.js";
import { chalk } from "../utils.js";
import type { ExportBundle } from "../types.js";

export function registerImportPostman(program: Command): void {
  program
    .command("import-postman <file>")
    .description("Import a Postman collection (v2.1) into a recli bundle")
    .option("-o, --output <path>", "Output file (default: <input>.recli.json)")
    .option("--env-file <path>", "Import a Postman environment file (.postman_environment.json)")
    .action((filePath: string, opts: { output?: string; envFile?: string }) => {
      const resolvedPath = path.resolve(filePath);
      if (!fs.existsSync(resolvedPath)) {
        printError(`File not found: ${resolvedPath}`);
        process.exit(1);
      }
      try {
        const bundle = importPostmanCollection(resolvedPath);
        const warnings = (bundle as ExportBundle & { importWarnings?: string[] }).importWarnings;
        // importWarnings is an in-memory-only hint — keep the output artifact clean.
        delete (bundle as ExportBundle & { importWarnings?: string[] }).importWarnings;

        if (opts.envFile) {
          const envPath = path.resolve(opts.envFile);
          if (!fs.existsSync(envPath)) {
            printError(`Environment file not found: ${envPath}`);
            process.exit(1);
          }
          const env = parsePostmanEnvironment(fs.readFileSync(envPath, "utf8"));
          bundle.environments = [...(bundle.environments ?? []), env];
          console.log(
            chalk.green(`Imported environment "${env.name}" (${env.variables.length} variable(s))`),
          );
        }

        const out = opts.output
          ? path.resolve(opts.output)
          : resolvedPath.replace(/\.json$/i, "") + ".recli.json";
        fs.writeFileSync(out, JSON.stringify(bundle, null, 2), "utf8");

        const totalRequests = bundle.collections.reduce((n, c) => n + c.requests.length, 0);
        console.log(
          chalk.green(
            `Imported ${bundle.collections.length} collection(s), ${totalRequests} request(s)`,
          ),
        );
        console.log(chalk.cyan(`  → ${out}`));

        for (const w of warnings ?? []) {
          console.log(chalk.yellow(`  ! ${w}`));
        }
        console.log(
          chalk.dim("Run it with: recli run <file> --env <name>  (pm.* scripts run natively)"),
        );
      } catch (e) {
        printError(e instanceof Error ? e.message : String(e));
        process.exit(1);
      }
    });
}

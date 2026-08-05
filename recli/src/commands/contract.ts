/**
 * `recli contract <spec> <collection>` — run a collection and validate every
 * response body against the response schema declared in an OpenAPI 3 spec.
 *
 * Exit code 1 when at least one contract check fails (schema violation).
 * Undocumented routes (no matching schema) are reported but do not fail.
 */
import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";

import { runCollection } from "../runner.js";
import { validateExportBundle } from "../validator.js";
import { parseSpec, checkContract } from "../contract.js";
import { resolveOpts, emitResults, chalk } from "../utils.js";
import { printError } from "../reporters.js";
import type { ExportBundle } from "../utils.js";

export function registerContract(program: Command): void {
  program
    .command("contract <spec> <collection>")
    .description("Validate API responses against an OpenAPI 3 spec")
    .action(async (specFile: string, collectionFile: string) => {
      const opts = resolveOpts(program);
      if (!opts.color) chalk.level = 0;

      // Load OpenAPI spec
      const specPath = path.resolve(specFile);
      if (!fs.existsSync(specPath)) {
        printError(`Spec not found: ${specPath}`);
        process.exit(1);
      }
      const doc = parseSpec(fs.readFileSync(specPath, "utf8"));
      if (!doc.openapi || !doc.paths) {
        printError("Invalid OpenAPI spec: missing 'openapi' version or 'paths'");
        process.exit(1);
      }

      // Load collection
      const colPath = path.resolve(collectionFile);
      if (!fs.existsSync(colPath)) {
        printError(`Collection not found: ${colPath}`);
        process.exit(1);
      }
      let bundle: unknown;
      try {
        bundle = JSON.parse(fs.readFileSync(colPath, "utf8"));
      } catch (e) {
        printError(`Failed to parse collection: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
      const errors = validateExportBundle(bundle);
      if (errors.length > 0) {
        for (const err of errors) printError(`  - ${err.path}: ${err.message}`);
        process.exit(1);
      }

      // Run the collection once (contract testing does not iterate)
      const timeoutMs = parseInt(opts.timeout, 10) || 30000;
      const results = await runCollection(bundle as ExportBundle, {
        envName: opts.env,
        timeoutMs,
        noColor: !opts.color,
        json: !!opts.json || opts.reporter === "json",
        parallel: !!opts.parallel,
        delayMs: opts.delay,
        iterations: 1,
        reporter: opts.reporter,
        output: opts.output,
        retries: opts.retries,
        retryOnStatus: opts.retryOn
          ? opts.retryOn
              .split(",")
              .map((s) => parseInt(s.trim(), 10))
              .filter((n) => !isNaN(n))
          : undefined,
        retryDelayMs: opts.retryDelay,
      });

      // Validate each response against the spec
      const checks = checkContract(results, doc);
      let contractFailed = 0;
      let noSchema = 0;
      for (const check of checks) {
        if (!check.schemaFound) {
          if (check.status !== 0) noSchema++;
          continue;
        }
        if (check.assertion) {
          if (!check.assertion.passed) contractFailed++;
          check.result.assertions = [...(check.result.assertions ?? []), check.assertion];
          if (!check.assertion.passed) check.result.passed = false;
        }
      }

      await emitResults(results, opts);

      console.log(
        chalk.bold(
          `\nContract: ${checks.length - noSchema} checked, ${contractFailed} failed, ${noSchema} no schema`,
        ),
      );
      if (contractFailed > 0) process.exit(1);
    });
}

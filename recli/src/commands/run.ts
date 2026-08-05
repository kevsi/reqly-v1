/**
 * `recli run <files...>` — run one or more collection files.
 */

import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";

import { runCollection, runWorkspace } from "../runner.js";
import { validateExportBundle } from "../validator.js";
import { resolveOpts, emitResults, chalk } from "../utils.js";
import { printError } from "../reporters.js";
import type { ExportBundle, RunResult, ResolvedOpts } from "../utils.js";

export function registerRun(program: Command): void {
  program
    .command("run <files...>")
    .description("Run one or more collection files")
    .option("--request <name>", "Run a single request by name")
    .action(async (files: string[], cmdOpts: { request?: string }) => {
      const opts = resolveOpts(program);
      if (!opts.color) chalk.level = 0;

      let results: RunResult[] = [];
      if (files.length === 1 && files[0].endsWith(".json")) {
        results = await loadAndRun(files[0], opts, cmdOpts.request);
      } else {
        results = await loadAndRunWorkspace(files, opts);
      }

      await emitResults(results, opts);
      if (results.filter((r) => !r.passed).length > 0) process.exit(1);
    });
}

async function loadAndRun(
  filePath: string,
  opts: ResolvedOpts,
  requestFilter?: string,
): Promise<RunResult[]> {
  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    printError(`File not found: ${resolvedPath}`);
    process.exit(1);
  }

  let bundle: unknown;
  try {
    bundle = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  } catch (e) {
    printError(`Failed to parse: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  const errors = validateExportBundle(bundle);
  if (errors.length > 0) {
    for (const err of errors) printError(`  - ${err.path}: ${err.message}`);
    process.exit(1);
  }

  const timeoutMs = parseInt(opts.timeout, 10);
  if (isNaN(timeoutMs) || timeoutMs < 1) {
    printError(`Invalid timeout: ${opts.timeout}`);
    process.exit(1);
  }

  return runCollection(bundle as ExportBundle, {
    envName: opts.env,
    timeoutMs,
    requestName: requestFilter,
    noColor: !opts.color,
    json: !!opts.json || opts.reporter === "json",
    parallel: !!opts.parallel,
    delayMs: opts.delay,
    iterations: opts.iterations,
    dataFile: opts.data,
    reporter: opts.reporter,
    output: opts.output,
    snapshot: opts.snapshot,
    updateSnapshots: opts.updateSnapshots,
    dotenv: opts.dotenv,
    allowLocalHosts: opts.allowLocalHosts,
    bail: opts.bail,
    retries: opts.retries,
    retryOnStatus: opts.retryOn
      ? opts.retryOn
          .split(",")
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => !isNaN(n))
      : undefined,
    retryDelayMs: opts.retryDelay,
  });
}

async function loadAndRunWorkspace(files: string[], opts: ResolvedOpts): Promise<RunResult[]> {
  const timeoutMs = parseInt(opts.timeout, 10) || 30000;
  return runWorkspace(files, {
    envName: opts.env,
    timeoutMs,
    noColor: !opts.color,
    json: !!opts.json,
    parallel: !!opts.parallel,
    delayMs: opts.delay,
    iterations: opts.iterations,
    dataFile: opts.data,
    reporter: opts.reporter,
    output: opts.output,
    snapshot: opts.snapshot,
    updateSnapshots: opts.updateSnapshots,
    dotenv: opts.dotenv,
    allowLocalHosts: opts.allowLocalHosts,
    bail: opts.bail,
    retries: opts.retries,
    retryOnStatus: opts.retryOn
      ? opts.retryOn
          .split(",")
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => !isNaN(n))
      : undefined,
    retryDelayMs: opts.retryDelay,
  });
}

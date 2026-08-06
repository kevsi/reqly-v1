/**
 * Shared CLI utilities.
 *
 * - `toCurl` / `countRequests`: small helpers used by the export command.
 * - `resolveOpts` / `ResolvedOpts`: merges Commander.js options with values
 *   from the project config (recli.config.* / .reclirc).
 * - `emitResults`: dispatches results to the configured reporter (cli, json,
 *   junit, html) and writes to disk when --output is set.
 * - `loadResultsFile`: reads NDJSON or JSON result files for the diff command.
 * - `simpleBodyDiff`: short diff summary for the diff command.
 */

import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import type { Command } from "commander";

import { loadConfig } from "./config.js";
import {
  reportCLI,
  reportJSON,
  buildJUnit,
  buildHTML,
  writeReport,
  printSummary,
  printError,
} from "./reporters.js";
import type { ExportBundle, RunResult } from "./types.js";

// Re-export shared types so command files can import them from a single module.
export type { ExportBundle, RunResult };

export interface ResolvedOpts {
  env?: string;
  timeout: string;
  color: boolean;
  json: boolean;
  parallel: boolean;
  delay: number;
  iterations: number;
  data?: string;
  reporter?: string;
  output?: string;
  snapshot?: boolean;
  updateSnapshots?: boolean;
  dotenv?: string;
  allowLocalHosts?: boolean;
  bail?: boolean;
  retries?: number;
  retryOn?: string;
  retryDelay?: number;
}

export function toCurl(req: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
}): string {
  let curl = `curl -X ${req.method} "${req.url}"`;
  if (req.headers) {
    for (const [k, v] of Object.entries(req.headers)) {
      curl += ` \\\n  -H "${k}: ${v}"`;
    }
  }
  if (req.body) {
    curl += ` \\\n  -d '${req.body.replace(/'/g, "'\\''")}'`;
  }
  return curl;
}

export function countRequests(bundle: ExportBundle): number {
  return bundle.collections.reduce((sum, c) => sum + c.requests.length, 0);
}

export function resolveOpts(prog: Command): ResolvedOpts {
  const cli = prog.opts<Record<string, string | boolean | undefined>>();
  const cfg = loadConfig();
  return {
    env: (cli.env as string) || cfg.env,
    timeout: (cli.timeout as string) || String(cfg.timeout || "30000"),
    color: cli.color !== false,
    json: !!cli.json || cfg.reporter === "json",
    parallel: !!cli.parallel || !!cfg.parallel,
    delay: parseInt((cli.delay as string) || String(cfg.delay || "0"), 10),
    iterations: parseInt((cli.iterations as string) || String(cfg.iterations || "1"), 10),
    data: (cli.data as string) || cfg.data,
    reporter: (cli.reporter as string) || cfg.reporter,
    output: (cli.output as string) || cfg.output,
    snapshot: !!cli.snapshot || !!cfg.snapshot,
    // Commander camelCase: --update-snapshots becomes updateSnapshots in opts
    updateSnapshots: !!(cli.updateSnapshots as boolean) || !!cfg.updateSnapshots,
    dotenv: (cli.dotenv as string) || cfg.dotenv,
    allowLocalHosts: !!cli.allowLocalHosts || !!cfg.allowLocalHosts,
    bail: !!cli.bail || !!cfg.bail,
    retries: parseInt((cli.retries as string) || String(cfg.retries || "0"), 10),
    retryOn: (cli.retryOn as string) || cfg.retryOn,
    retryDelay: parseInt((cli.retryDelay as string) || String(cfg.retryDelay || "300"), 10),
  };
}

export async function emitResults(results: RunResult[], opts: ResolvedOpts): Promise<void> {
  const reporter = opts.reporter || (opts.json ? "json" : "cli");
  const outputPath = opts.output;

  switch (reporter) {
    case "json": {
      const out = reportJSON(results);
      if (outputPath) writeReport(out, outputPath);
      else console.log(out);
      break;
    }
    case "junit": {
      const out = buildJUnit(results);
      if (outputPath) writeReport(out, outputPath);
      else writeReport(out, `recli-report-${Date.now()}.xml`);
      break;
    }
    case "html": {
      const out = buildHTML(results);
      if (outputPath) writeReport(out, outputPath);
      else writeReport(out, `recli-report-${Date.now()}.html`);
      break;
    }
    default: {
      reportCLI(results);
      break;
    }
  }
  printSummary(results, reporter === "json");
}

export function loadResultsFile(fp: string): RunResult[] {
  const resolvedPath = path.resolve(fp);
  if (!fs.existsSync(resolvedPath)) {
    printError(`File not found: ${resolvedPath}`);
    process.exit(1);
  }
  const content = fs.readFileSync(resolvedPath, "utf8");
  const lines = content.trim().split("\n").filter(Boolean);
  if (lines.length === 1 && lines[0].startsWith("[")) return JSON.parse(content) as RunResult[];
  return lines.map((l) => JSON.parse(l)) as RunResult[];
}

export function simpleBodyDiff(before?: string, after?: string): string {
  if (!before && !after) return "";
  if (!before) return "(new)";
  if (!after) return "(removed)";
  return before.length !== after.length
    ? `${before.length} → ${after.length} bytes`
    : "content changed";
}

/**
 * Reads a JSON file from disk, exiting the process on parse errors.
 * Used by commands that consume ExportBundle files.
 */
export function readBundleOrExit(filePath: string): ExportBundle {
  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    printError(`File not found: ${resolvedPath}`);
    process.exit(1);
  }
  try {
    return JSON.parse(fs.readFileSync(resolvedPath, "utf8")) as ExportBundle;
  } catch (e) {
    printError(`Failed to parse: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}

/** Expose chalk via utils so command files don't need to import it directly. */
export { chalk };

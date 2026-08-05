#!/usr/bin/env node

import { program } from "commander";
import fs from "node:fs";
import { registerRun } from "./commands/run.js";
import { registerGraphql } from "./commands/graphql.js";
import {
  registerValidate,
  registerInit,
  registerExport,
  registerWatch,
} from "./commands/validate.js";
import { registerOpenApi } from "./commands/openapi.js";
import { registerDiff } from "./commands/diff.js";
import { registerTui } from "./commands/tui.js";
import { registerServe } from "./commands/serve.js";
import { registerContract } from "./commands/contract.js";
import { registerGenerate } from "./commands/generate.js";
import { registerImportPostman } from "./commands/import-postman.js";

const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

program
  .name("recli")
  .description("API testing CLI — run, assert, chain, report")
  .version(pkg.version);

// Global options (reused across commands)
const GLOBAL_OPTIONS = [
  ["--env <name>", "Select environment by name"],
  ["--timeout <ms>", "Request timeout in milliseconds", "30000"],
  ["--no-color", "Disable colored output"],
  ["--json", "Output NDJSON for CI"],
  ["--parallel", "Run requests in parallel"],
  ["--delay <ms>", "Delay between requests in ms", "0"],
  ["--iterations <n>", "Number of iterations", "1"],
  ["--data <file>", "Data file for iterations (CSV or JSON)"],
  ["--reporter <format>", "Reporter: cli, json, junit, html"],
  ["-o, --output <path>", "Write report to file"],
  ["--snapshot", "Enable snapshot testing"],
  ["--update-snapshots", "Update saved snapshots"],
  ["--dotenv <file>", "Import .env file"],
  [
    "--allow-local-hosts",
    "Allow pm.sendRequest in scripts to reach localhost/private networks (dev only)",
  ],
  ["--bail", "Stop at the first failed request (fail-fast)"],
  ["--retries <n>", "Retry on transient failures (network errors or --retry-on codes)", "0"],
  ["--retry-on <codes>", "Comma-separated status codes to retry on (default: 429,502,503,504)"],
  ["--retry-delay <ms>", "Base delay (ms) for exponential backoff between retries", "300"],
] as const;

for (const [flags, desc, defaultVal] of GLOBAL_OPTIONS) {
  if (defaultVal) program.option(flags, desc, defaultVal);
  else program.option(flags, desc);
}

// Register all commands
registerRun(program);
registerGraphql(program);
registerValidate(program);
registerInit(program);
registerExport(program);
registerWatch(program);
registerOpenApi(program);
registerDiff(program);
registerTui(program);
registerServe(program);
registerContract(program);
registerGenerate(program);
registerImportPostman(program);

program.parse();

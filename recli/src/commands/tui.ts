/**
 * `recli ui <file>` — interactive terminal UI to browse and run requests.
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import chalk from "chalk";
import type { Command } from "commander";

import { flattenRequests, executeRequest } from "../runner.js";
import { isValidExportBundle } from "../validator.js";
import { reportCLI, printError } from "../reporters.js";
import type { ExportBundle, RequestItem, RunnerContext } from "../types.js";

export function registerTui(program: Command): void {
  program
    .command("ui <file>")
    .description("Interactive terminal UI to explore and run requests")
    .action(async (filePath: string) => {
      const resolvedPath = path.resolve(filePath);
      if (!fs.existsSync(resolvedPath)) {
        printError(`File not found: ${resolvedPath}`);
        process.exit(1);
      }
      const content = fs.readFileSync(resolvedPath, "utf8");
      if (!isValidExportBundle(JSON.parse(content))) {
        printError("Invalid collection");
        process.exit(1);
      }
      const bundle = JSON.parse(content) as ExportBundle;
      await interactiveUI(bundle, resolvedPath);
    });
}

async function interactiveUI(bundle: ExportBundle, _filePath: string): Promise<void> {
  const requests = flattenRequests(bundle);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.clear();
  console.log(chalk.cyan.bold(`\n  recli UI — ${bundle.collections[0].name}\n`));

  let running = true;
  while (running) {
    console.log(chalk.dim("  Requests:"));
    // Paginate: show max 20 at a time
    const pageSize = 20;
    for (let page = 0; page < requests.length; page += pageSize) {
      const slice = requests.slice(page, page + pageSize);
      for (let i = 0; i < slice.length; i++) {
        const r = slice[i];
        const idx = page + i + 1;
        if (idx > 99) break; // keep alignment clean
        const methodColor = methodToColor(r.method);
        console.log(
          `  ${chalk.dim(`${idx}.`)} ${methodColor(r.method)} ${chalk.dim(r.url)}  ${chalk.white(r.name)}`,
        );
      }
      if (page + pageSize < requests.length) {
        console.log(chalk.dim(`  ... ${requests.length - page - pageSize} more`));
      }
    }
    console.log();
    console.log(`  ${chalk.dim("a)")} Run all    ${chalk.dim("q)")} Quit`);

    const answer = await ask(rl, "  Select: ");
    if (!answer) continue;

    if (answer.toLowerCase() === "q") {
      running = false;
      break;
    }
    if (answer.toLowerCase() === "a") {
      console.clear();
      console.log(chalk.cyan("\nRunning all requests...\n"));
      const ctx: RunnerContext = {
        vars: new Map(),
        envVars: new Map(),
        cookies: new Map(),
        iteration: 0,
      };
      for (const req of requests) {
        const result = await executeRequest(req, ctx, 30000);
        reportCLI([result]);
      }
      console.log(chalk.dim("\nPress Enter to continue..."));
      await waitForEnter(rl);
      console.clear();
      continue;
    }

    const idx = parseInt(answer, 10) - 1;
    if (idx >= 0 && idx < requests.length) {
      await runSingleInteractive(rl, requests[idx]);
      console.clear();
    }
  }

  rl.close();
}

async function runSingleInteractive(rl: readline.Interface, request: RequestItem): Promise<void> {
  console.clear();
  console.log(`\n  ${methodToColor(request.method)(request.method)} ${chalk.bold(request.name)}`);
  console.log(`  ${chalk.dim(request.url)}\n`);

  const ctx: RunnerContext = {
    vars: new Map(),
    envVars: new Map(),
    cookies: new Map(),
    iteration: 0,
  };
  const result = await executeRequest(request, ctx, 30000);

  const icon = result.passed ? chalk.green("✓") : chalk.red("✗");
  console.log(`\n  ${icon} ${chalk.bold(result.method)} ${result.url}`);
  console.log(
    `  ${result.passed ? chalk.green(result.status) : chalk.red(result.status)} ${chalk.dim(result.statusText)}  ${chalk.dim(`${result.durationMs}ms`)}`,
  );

  if (result.error) console.log(`  ${chalk.red(result.error)}`);

  if (result.body) {
    const preview = result.body.length > 500 ? result.body.slice(0, 500) + "..." : result.body;
    console.log(`\n  ${chalk.dim("Response:")}`);
    try {
      console.log(`  ${chalk.dim(JSON.stringify(JSON.parse(preview), null, 2))}`);
    } catch {
      console.log(`  ${chalk.dim(preview)}`);
    }
  }

  if (result.responseHeaders) {
    console.log(`\n  ${chalk.dim("Headers:")}`);
    for (const [k, v] of Object.entries(result.responseHeaders).slice(0, 10)) {
      console.log(`  ${chalk.dim(`${k}: ${v}`)}`);
    }
  }

  console.log(chalk.dim("\nPress Enter to return..."));
  await waitForEnter(rl);
}

function methodToColor(method: string): (s: string) => string {
  const colors: Record<string, (s: string) => string> = {
    GET: chalk.green,
    POST: chalk.blue,
    PUT: chalk.yellow,
    PATCH: chalk.yellow,
    DELETE: chalk.red,
    HEAD: chalk.cyan,
    OPTIONS: chalk.magenta,
    GRAPHQL: chalk.magenta,
  };
  return colors[method] || chalk.white;
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

function waitForEnter(rl: readline.Interface): Promise<void> {
  return new Promise((resolve) => {
    const onLine = () => {
      rl.removeListener("line", onLine);
      resolve();
    };
    rl.on("line", onLine);
    setTimeout(() => {
      rl.removeListener("line", onLine);
      resolve();
    }, 30000);
  });
}

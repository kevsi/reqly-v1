/**
 * `recli ui <file>` — interactive full-screen terminal UI to browse, search,
 * and run requests (modern API-testing TUI, zero external dependencies).
 */

import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";

import { isValidExportBundle } from "../validator.js";
import { printError } from "../reporters.js";
import { resolveOpts } from "../utils.js";
import type { ExportBundle } from "../types.js";
import { Tui } from "../tui/screen.js";

export function registerTui(program: Command): void {
  program
    .command("ui <file>")
    .description("Interactive full-screen terminal UI to browse and run requests")
    .action(async (filePath: string) => {
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

      if (!isValidExportBundle(bundle)) {
        printError("Invalid collection");
        process.exit(1);
      }

      if (!process.stdout.isTTY || !process.stdin.isTTY) {
        printError("`recli ui` requires an interactive terminal");
        process.exit(1);
      }

      const opts = resolveOpts(program);
      const tui = new Tui(bundle as ExportBundle, {
        timeoutMs: parseInt(opts.timeout, 10) || 30000,
        allowLocalHosts: opts.allowLocalHosts,
      });
      await tui.start();
      if (tui.lastSummary) console.log(tui.lastSummary);
    });
}

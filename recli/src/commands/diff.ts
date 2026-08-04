/**
 * `recli diff <before> <after>` — compare two result JSON files.
 *
 * Matching is done by request name (not index) so reordering requests in a
 * collection does not produce false positives. Duplicate names are matched by
 * URL first (identical reordered requests pair up cleanly), falling back to
 * FIFO per name — nothing is silently dropped, and duplicates are reported as
 * a warning.
 */

import chalk from "chalk";
import type { Command } from "commander";

import { loadResultsFile, simpleBodyDiff } from "../utils.js";
import type { RunResult, DiffResult } from "../types.js";

export function registerDiff(program: Command): void {
  program
    .command("diff <before> <after>")
    .description("Compare two result JSON files")
    .action((beforeFile: string, afterFile: string) => {
      const before = loadResultsFile(beforeFile);
      const after = loadResultsFile(afterFile);
      for (const name of findDuplicateNames([...before, ...after])) {
        console.warn(
          chalk.yellow(`Warning: "${name}" appears multiple times — entries are matched in order`),
        );
      }
      const diffs = computeDiff(before, after);
      printDiff(diffs);
      if (diffs.some((d) => d.statusChanged || d.bodyChanged)) process.exit(1);
    });
}

/** Names that occur more than once across a result set (matched in FIFO order). */
export function findDuplicateNames(results: RunResult[]): string[] {
  const counts = new Map<string, number>();
  for (const r of results) counts.set(r.name, (counts.get(r.name) ?? 0) + 1);
  return [...counts.entries()].filter(([, n]) => n > 1).map(([name]) => name);
}

export function computeDiff(before: RunResult[], after: RunResult[]): DiffResult[] {
  // Per-name queues; entries are consumed on match. Same-name duplicates are
  // paired by URL first (so reordered identical requests produce no spurious
  // diff), falling back to FIFO order.
  const afterByName = new Map<string, RunResult[]>();
  for (const r of after) {
    const q = afterByName.get(r.name);
    if (q) q.push(r);
    else afterByName.set(r.name, [r]);
  }

  const takeMatch = (name: string, url: string): RunResult | undefined => {
    const q = afterByName.get(name);
    if (!q) return undefined;
    const byUrl = q.findIndex((r) => r.url === url);
    return byUrl >= 0 ? q.splice(byUrl, 1)[0] : q.shift();
  };

  const diffs: DiffResult[] = [];

  // Walk through "before" and match by name (consume one after-entry per name)
  for (const b of before) {
    const a = takeMatch(b.name, b.url);
    if (!a) {
      diffs.push({
        name: b.name,
        url: b.url,
        statusChanged: true,
        oldStatus: b.status,
        newStatus: 0,
        bodyChanged: true,
        oldDuration: b.durationMs,
        newDuration: 0,
        durationChanged: true,
        passedBefore: b.passed,
        passedAfter: false,
      });
      continue;
    }
    const statusChanged = b.status !== a.status;
    const bodyChanged = b.body !== a.body;
    const durationChanged = Math.abs(b.durationMs - a.durationMs) > 100;
    diffs.push({
      name: a.name,
      url: a.url,
      statusChanged,
      oldStatus: b.status,
      newStatus: a.status,
      bodyChanged,
      bodyDiff: bodyChanged ? simpleBodyDiff(b.body, a.body) : undefined,
      durationChanged,
      oldDuration: b.durationMs,
      newDuration: a.durationMs,
      passedBefore: b.passed,
      passedAfter: a.passed,
    });
  }

  // Handle "after" entries not matched by any "before" entry
  for (const q of afterByName.values()) {
    for (const a of q) {
      diffs.push({
        name: a.name,
        url: a.url,
        statusChanged: true,
        oldStatus: 0,
        newStatus: a.status,
        bodyChanged: true,
        oldDuration: 0,
        newDuration: a.durationMs,
        durationChanged: true,
        passedBefore: false,
        passedAfter: a.passed,
      });
    }
  }

  return diffs;
}

function printDiff(diffs: DiffResult[]): void {
  console.log(chalk.bold(`\nDiff Report (${diffs.length} requests)`));
  let changes = 0;
  for (const d of diffs) {
    const hasChanges = d.statusChanged || d.bodyChanged || d.durationChanged;
    if (hasChanges) changes++;
    const icon = hasChanges ? chalk.yellow("~") : chalk.green("=");
    console.log(`\n${icon} ${chalk.bold(d.name)}`);
    console.log(`   ${d.url}`);
    if (d.statusChanged)
      console.log(`   ${chalk.yellow("status:")} ${d.oldStatus} → ${d.newStatus}`);
    else console.log(`   ${chalk.green("status:")} ${d.newStatus} (unchanged)`);
    if (d.bodyChanged) console.log(`   ${chalk.yellow("body:")}   ${d.bodyDiff || "changed"}`);
    if (d.durationChanged)
      console.log(`   ${chalk.yellow("time:")}  ${d.oldDuration}ms → ${d.newDuration}ms`);
    if (d.passedBefore !== d.passedAfter) {
      console.log(
        `   ${chalk.yellow("result:")} ${d.passedBefore ? "pass" : "fail"} → ${d.passedAfter ? "pass" : "fail"}`,
      );
    }
  }
  console.log(chalk.bold(`\n${changes} changed, ${diffs.length - changes} unchanged`));
}

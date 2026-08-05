/**
 * Full-screen interactive TUI for `recli ui <file>`.
 *
 * Zero-dependency (Node + chalk): alternate screen buffer, raw keypress,
 * live search, environment picker, request runner with spinners, an inspect
 * view (request definition before running), and a tabbed result detail view
 * (body / headers / assertions).
 *
 * Pure formatting helpers are exported for unit tests.
 */

import chalk from "chalk";
import { executeRequest, flattenRequests } from "../runner.js";
import { startKeypress, type KeyInfo } from "./keypress.js";
import type { Environment, ExportBundle, RequestItem, RunResult, RunnerContext } from "../types.js";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const ALT_BUF_IN = "\x1b[?1049h";
const ALT_BUF_OUT = "\x1b[?1049l";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const HOME_CLEAR = "\x1b[H\x1b[2J";

const ANSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]/g;

// ── Pure helpers (exported for tests) ───────────────────────

/** Visible length of a string, ignoring ANSI escape sequences. */
export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + "…";
}

/** Truncate a possibly-ANSI-styled string to a column budget (styling is lost past the budget). */
export function fitToCols(s: string, cols: number): string {
  return stripAnsi(s).length <= cols ? s : truncate(stripAnsi(s), cols);
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

export function filterRequests(requests: RequestItem[], query: string): RequestItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return requests;
  return requests.filter(
    (r) => r.name.toLowerCase().includes(q) || r.url.toLowerCase().includes(q),
  );
}

export function methodStyle(method: string): (s: string) => string {
  switch (method) {
    case "GET":
      return chalk.green;
    case "POST":
      return chalk.blue;
    case "PUT":
    case "PATCH":
      return chalk.yellow;
    case "DELETE":
      return chalk.red;
    case "HEAD":
      return chalk.cyan;
    case "OPTIONS":
    case "GRAPHQL":
      return chalk.magenta;
    default:
      return chalk.white;
  }
}

export function statusStyle(status: number): (s: string) => string {
  if (status >= 200 && status < 300) return chalk.green;
  if (status >= 400) return chalk.red;
  return chalk.yellow;
}

export function prettyBody(body: string | undefined, maxLines = 40): string {
  if (!body) return "(no body)";
  let text = body;
  if (body.startsWith("{") || body.startsWith("[")) {
    try {
      text = JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      /* keep raw */
    }
  }
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  return lines.slice(0, maxLines).join("\n") + `\n… (${lines.length - maxLines} more lines)`;
}

/** Enabled variables of an environment, as a map ({{var}} interpolation source). */
export function buildEnvVars(env: Environment | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const v of env?.variables ?? []) {
    if (v.enabled) map.set(v.key, v.value);
  }
  return map;
}

/** Underline the first case-insensitive match of `query` in `text`. */
function highlight(text: string, query: string): string {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    text.slice(0, idx) +
    chalk.underline(text.slice(idx, idx + query.length)) +
    text.slice(idx + query.length)
  );
}

// ── TUI ─────────────────────────────────────────────────────

type Mode = "list" | "search" | "inspect" | "detail" | "env" | "help";
type Tab = "body" | "headers" | "assertions";

export interface TuiOptions {
  timeoutMs?: number;
  /** Allow requests to localhost/private networks (dev only). */
  allowLocalHosts?: boolean;
}

export class Tui {
  private bundle: ExportBundle;
  private requests: RequestItem[];
  private filtered: RequestItem[] = [];
  private cursor = 0;
  private filter = "";
  private mode: Mode = "list";
  private tab: Tab = "body";
  private envIndex = 0;
  private results = new Map<RequestItem, RunResult>();
  private running: RequestItem | null = null;
  private runningAll = false;
  private runningCount = 0;
  private spinnerTick = 0;
  private spinnerTimer: NodeJS.Timeout | null = null;
  private cleanupKeypress: (() => void) | null = null;
  private doneResolve: (() => void) | null = null;
  private done = new Promise<void>((r) => {
    this.doneResolve = r;
  });
  /** Transient status (e.g. environment switched) — cleared on navigation. */
  private statusMessage = "";
  /** Final summary (run-all) — printed after the TUI exits. */
  lastSummary = "";
  private timeoutMs: number;
  private allowLocalHosts: boolean;

  private readonly sigintHandler = (): void => this.exit();
  private readonly sigtermHandler = (): void => this.exit();
  private readonly resizeHandler = (): void => this.render();

  constructor(bundle: ExportBundle, options: TuiOptions = {}) {
    this.bundle = bundle;
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.allowLocalHosts = options.allowLocalHosts ?? false;
    this.requests = flattenRequests(bundle);
    this.filtered = [...this.requests];
  }

  // ── lifecycle ──────────────────────────────────────────────

  async start(): Promise<void> {
    this.write(ALT_BUF_IN + HIDE_CURSOR);
    this.cleanupKeypress = startKeypress((k) => this.onKey(k));
    process.once("SIGINT", this.sigintHandler);
    process.once("SIGTERM", this.sigtermHandler);
    process.stdout.on("resize", this.resizeHandler);
    this.render();
    await this.done;
  }

  private exit(): void {
    if (this.spinnerTimer) clearInterval(this.spinnerTimer);
    this.cleanupKeypress?.();
    process.removeListener("SIGINT", this.sigintHandler);
    process.removeListener("SIGTERM", this.sigtermHandler);
    process.stdout.removeListener("resize", this.resizeHandler);
    this.write(SHOW_CURSOR + ALT_BUF_OUT);
    this.doneResolve?.();
  }

  /** Guarded stdout write so a closed terminal (EPIPE) cannot crash the loop. */
  private write(s: string): void {
    try {
      process.stdout.write(s);
    } catch {
      /* terminal closed */
    }
  }

  // ── terminal metrics ───────────────────────────────────────

  private get rows(): number {
    return process.stdout.rows || 24;
  }
  private get cols(): number {
    return process.stdout.columns || 80;
  }
  private get env(): Environment | undefined {
    return this.bundle.environments?.[this.envIndex];
  }

  // ── input ──────────────────────────────────────────────────

  private onKey(k: KeyInfo): void {
    if (k.ctrl && k.name === "c") {
      this.exit();
      return;
    }
    if (this.runningAll) return;
    switch (this.mode) {
      case "search":
        this.onSearchKey(k);
        return;
      case "inspect":
        this.onInspectKey(k);
        return;
      case "detail":
        this.onDetailKey(k);
        return;
      case "env":
        this.onEnvKey(k);
        return;
      case "help":
        this.mode = "list";
        this.render();
        return;
      case "list":
        this.onListKey(k);
        return;
    }
  }

  private onListKey(k: KeyInfo): void {
    const s = k.name && k.name.length === 1 ? k.name : k.sequence;
    switch (k.name) {
      case "up":
      case "k":
        this.move(-1);
        break;
      case "down":
      case "j":
        this.move(1);
        break;
      case "pageup":
        this.move(-(this.rows - 4));
        break;
      case "pagedown":
        this.move(this.rows - 4);
        break;
      case "home":
      case "g":
        this.cursor = 0;
        break;
      case "end":
      case "G":
        this.cursor = this.filtered.length - 1;
        break;
      case "return":
        void this.runSelected();
        return;
      case "space":
      case "i":
        this.mode = "inspect";
        break;
      case "v":
        this.viewLastResult();
        break;
      case "e":
        this.mode = "env";
        break;
      case "h":
        this.mode = "help";
        break;
      case "q":
        this.exit();
        return;
      default:
        if (s === "/") this.mode = "search";
        else return;
    }
    this.render();
  }

  private onSearchKey(k: KeyInfo): void {
    const s = k.name && k.name.length === 1 ? k.name : k.sequence;
    if (k.name === "escape" || k.name === "return") {
      this.mode = "list";
    } else if (k.name === "backspace") {
      this.filter = this.filter.slice(0, -1);
    } else if (k.ctrl && k.name === "w") {
      this.filter = "";
    } else if (s && s.length === 1 && s >= " ") {
      this.filter += s;
    }
    this.filtered = filterRequests(this.requests, this.filter);
    this.cursor = Math.min(this.cursor, Math.max(0, this.filtered.length - 1));
    this.render();
  }

  private onInspectKey(k: KeyInfo): void {
    switch (k.name) {
      case "escape":
      case "backspace":
        this.mode = "list";
        break;
      case "return":
      case "r":
        void this.runSelected();
        return;
      case "n":
        this.cursor = Math.max(0, Math.min(this.cursor + 1, this.filtered.length - 1));
        break;
      case "p":
        this.cursor = Math.max(this.cursor - 1, 0);
        break;
      case "q":
        this.exit();
        return;
      default:
        return;
    }
    this.render();
  }

  private onDetailKey(k: KeyInfo): void {
    switch (k.name) {
      case "escape":
      case "backspace":
        this.mode = "list";
        break;
      case "r":
      case "return":
        void this.runSelected();
        return;
      case "n":
        this.cursor = Math.max(0, Math.min(this.cursor + 1, this.filtered.length - 1));
        void this.runSelected();
        return;
      case "p":
        this.cursor = Math.max(this.cursor - 1, 0);
        void this.runSelected();
        return;
      case "b":
        this.tab = "body";
        break;
      case "h":
        this.tab = "headers";
        break;
      case "a":
        this.tab = "assertions";
        break;
      case "tab":
        this.tab = this.tab === "body" ? "headers" : this.tab === "headers" ? "assertions" : "body";
        break;
      case "q":
        this.exit();
        return;
      default:
        return;
    }
    this.render();
  }

  private onEnvKey(k: KeyInfo): void {
    const count = this.bundle.environments?.length ?? 0;
    switch (k.name) {
      case "up":
      case "k":
        this.envIndex = Math.max(0, this.envIndex - 1);
        break;
      case "down":
      case "j":
        this.envIndex = Math.min(Math.max(0, count - 1), this.envIndex + 1);
        break;
      case "return":
        this.mode = "list";
        this.statusMessage = `Environment: ${this.env?.name ?? "none"}`;
        break;
      case "escape":
      case "backspace":
        this.mode = "list";
        break;
      case "q":
        this.exit();
        return;
      default:
        break;
    }
    this.render();
  }

  private move(delta: number): void {
    if (this.filtered.length === 0) return;
    this.cursor = Math.max(0, Math.min(this.filtered.length - 1, this.cursor + delta));
    this.statusMessage = "";
  }

  // ── running ────────────────────────────────────────────────

  private makeCtx(): RunnerContext {
    return {
      vars: new Map(),
      envVars: buildEnvVars(this.env),
      cookies: new Map(),
      iteration: 0,
    };
  }

  private async runSelected(): Promise<void> {
    const item = this.filtered[this.cursor];
    if (!item) return;
    this.running = item;
    this.statusMessage = "";
    this.lastSummary = "";
    this.render();
    const result = await executeRequest(item, this.makeCtx(), this.timeoutMs, {
      timeoutMs: this.timeoutMs,
      allowLocalHosts: this.allowLocalHosts,
    });
    this.results.set(item, result);
    this.running = null;
    // Keep the current tab across reruns/navigation so audits aren't interrupted.
    this.mode = "detail";
    this.render();
  }

  private viewLastResult(): void {
    const item = this.filtered[this.cursor];
    if (item && this.results.has(item)) {
      this.mode = "detail";
      this.render();
    }
  }

  /** Run the current filtered selection (all requests when the filter is empty). */
  private async runAll(): Promise<void> {
    const runSet = this.filtered;
    if (this.runningAll || runSet.length === 0) return;
    this.runningAll = true;
    this.runningCount = runSet.length;
    this.statusMessage = "";
    this.lastSummary = "";
    this.startSpinner();
    const ctx = this.makeCtx();
    const started = Date.now();
    try {
      for (const item of runSet) {
        this.running = item;
        this.render();
        const result = await executeRequest(item, ctx, this.timeoutMs, {
          timeoutMs: this.timeoutMs,
          allowLocalHosts: this.allowLocalHosts,
        });
        this.results.set(item, result);
      }
    } finally {
      // Even if a request throws, never leave the spinner running or the input frozen.
      this.running = null;
      this.runningAll = false;
      this.stopSpinner();
    }
    const passed = runSet.filter((i) => this.results.get(i)?.passed).length;
    const label =
      runSet.length < this.requests.length
        ? `${runSet.length} selected`
        : `${this.requests.length} requests`;
    this.lastSummary = `${passed}/${runSet.length} passed (${label}) in ${((Date.now() - started) / 1000).toFixed(1)}s`;
    this.mode = "list";
    this.render();
  }

  private startSpinner(): void {
    if (this.spinnerTimer) return;
    this.spinnerTimer = setInterval(() => {
      this.spinnerTick++;
      this.render();
    }, 100);
  }

  private stopSpinner(): void {
    if (this.spinnerTimer) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = null;
    }
  }

  // ── rendering ──────────────────────────────────────────────

  private render(): void {
    const C = this.cols;
    const R = this.rows;
    const body = Math.max(4, R - 4);
    const lines: string[] = [this.headerLine(C), this.statusOrSearchLine(C)];
    switch (this.mode) {
      case "detail":
      case "inspect":
        lines.push(...this.detailLines(C).slice(0, body));
        break;
      case "env":
        lines.push(...this.envLines().slice(0, body));
        break;
      case "help":
        lines.push(...this.helpLines(C).slice(0, body));
        break;
      default:
        lines.push(...this.listLines(body, C));
    }
    while (lines.length < R - 1) lines.push("");
    lines.push(this.barLine(C));
    // No trailing newline: exactly R lines keep the alternate buffer from scrolling.
    this.write(HOME_CLEAR + lines.slice(0, R).join("\n"));
  }

  private headerLine(C: number): string {
    const colName = truncate(this.bundle.collections[0]?.name ?? "Collection", 40);
    const extra =
      this.bundle.collections.length > 1 ? ` +${this.bundle.collections.length - 1}` : "";
    const leftPlain = `recli · ${colName}${extra}`;
    const envName = this.env?.name ?? "none";
    const rightPlain = `env ● ${envName} · ${this.requests.length} requests`;
    const pad = Math.max(1, C - leftPlain.length - rightPlain.length - 2);
    return fitToCols(
      `${chalk.bold("recli")}${chalk.dim(" · ")}${chalk.bold(colName)}${chalk.dim(extra)}` +
        " ".repeat(pad) +
        chalk.dim("env ") +
        chalk.cyanBright(`● ${envName}`) +
        chalk.dim(` · ${this.requests.length} requests`),
      C,
    );
  }

  private statusOrSearchLine(C: number): string {
    if (this.mode === "search") {
      const shown = this.filtered.length;
      const hint =
        shown === this.requests.length
          ? chalk.dim("  type to filter · Esc close")
          : chalk.dim(`  ${shown}/${this.requests.length} shown`);
      return `  ${chalk.dim("/")}${this.filter}${chalk.inverse(" ")}${hint}`;
    }
    if (this.runningAll) {
      const what =
        this.runningCount === this.requests.length
          ? "all requests"
          : `${this.runningCount} selected`;
      return `  ${chalk.cyan(`Running ${what}…`)}`;
    }
    if (this.running) return `  ${chalk.cyan("Running…")}`;
    if (this.statusMessage) return `  ${chalk.dim(this.statusMessage)}`;
    if (this.lastSummary) return `  ${chalk.dim(this.lastSummary)}`;
    return `  ${chalk.dim(`type ${chalk.cyan("/")} to search`)}${chalk.dim(`  ·  ${this.filtered.length}/${this.requests.length} requests`)}`;
  }

  private listLines(height: number, C: number): string[] {
    const lines: string[] = [];
    if (this.filtered.length === 0) {
      lines.push(chalk.dim(`  No requests match "${this.filter}"`));
      return lines;
    }
    const start = Math.max(
      0,
      Math.min(this.cursor - Math.floor(height / 2), this.filtered.length - height),
    );
    for (let i = start; i < Math.min(this.filtered.length, start + height); i++) {
      lines.push(this.listRow(this.filtered[i]!, C));
    }
    return lines;
  }

  private listRow(item: RequestItem, C: number): string {
    const selected = this.filtered[this.cursor] === item;
    const prefix = selected ? chalk.cyanBright("▸ ") : "  ";
    const method = methodStyle(item.method)(item.method.padEnd(6));
    // Fixed parts sum to ~53 (prefix 2 + method 6 + name 16 + status 24 + gaps).
    const urlMax = Math.max(8, C - 53);
    const q = this.mode === "search" ? this.filter : "";
    let url = highlight(truncate(item.url, urlMax), q);
    url = chalk.dim(url);
    const name = chalk.dim(truncate(item.name, 16));

    let right = "";
    if (this.running === item) {
      right = chalk.cyan(SPINNER[this.spinnerTick % SPINNER.length]!);
    } else {
      const result = this.results.get(item);
      if (result) {
        const dot = result.passed ? chalk.green("●") : chalk.red("●");
        const code = result.status ? String(result.status) : "ERR";
        let mid = result.passed ? statusStyle(result.status)(code) : chalk.red(code);
        if (result.assertions?.length) {
          const ok = result.assertions.filter((a) => a.passed).length;
          const badge = ok === result.assertions.length ? chalk.green : chalk.red;
          mid += chalk.dim(" ") + badge(`${ok}/${result.assertions.length}`);
        }
        right = `${dot} ${mid}${result.durationMs ? chalk.dim(` ${result.durationMs}ms`) : ""}`;
      }
    }

    const row = `${prefix}${method} ${url}  ${name}  ${right}`;
    const fitted = fitToCols(row, C);
    return selected && this.running !== item ? chalk.inverse(fitted) : fitted;
  }

  private detailLines(C: number): string[] {
    const item = this.filtered[this.cursor];
    const lines: string[] = [];
    if (!item) {
      lines.push(chalk.dim("  No request selected"));
      return lines;
    }
    lines.push(`${methodStyle(item.method)(item.method.padEnd(6))} ${chalk.bold(item.name)}`);
    lines.push(chalk.dim(item.url));
    const result = this.results.get(item);

    // No result yet — inspect the request definition.
    if (!result) {
      lines.push(...this.requestDefLines(item, C));
      return lines;
    }

    const statusText = result.status
      ? `${result.status} ${result.statusText}`
      : result.statusText || "Error";
    lines.push("");
    lines.push(
      `  ${chalk.dim("Status:")} ${result.passed ? statusStyle(result.status)(statusText) : chalk.red(statusText)}` +
        `  ${chalk.dim("Time:")} ${result.durationMs}ms` +
        `  ${chalk.dim("Size:")} ${fmtBytes(result.size)}`,
    );
    if (result.error) lines.push(`  ${chalk.red(result.error)}`);
    if (result.snapshotChanged) lines.push(`  ${chalk.yellow("■ snapshot changed")}`);
    lines.push("");
    lines.push(this.tabsLine());

    switch (this.tab) {
      case "headers": {
        const headers = result.responseHeaders ?? {};
        const entries = Object.entries(headers);
        if (entries.length === 0) {
          lines.push(chalk.dim("  (no response headers)"));
        } else {
          for (const [k, v] of entries.slice(0, 80)) {
            lines.push(`  ${chalk.dim(k + ":")} ${truncate(v, Math.max(4, C - 6))}`);
          }
          if (entries.length > 80) lines.push(chalk.dim(`  … ${entries.length - 80} more headers`));
        }
        break;
      }
      case "assertions":
        this.assertionLines(result, lines);
        this.captureLines(result, lines);
        break;
      default: {
        lines.push(`  ${chalk.dim("Body:")}`);
        const remaining = Math.max(6, this.rows - lines.length - 2);
        for (const line of prettyBody(result.body, remaining).split("\n")) {
          lines.push(`  ${truncate(line, Math.max(4, C - 4))}`);
        }
      }
    }
    return lines;
  }

  private tabsLine(): string {
    const render = (label: string, active: boolean): string =>
      active ? chalk.bold(chalk.inverse(` ${label} `)) : chalk.dim(` ${label} `);
    return (
      `  ${render("Body", this.tab === "body")}` +
      `${render("Headers", this.tab === "headers")}` +
      `${render("Assertions", this.tab === "assertions")}` +
      chalk.dim("   b/h/a · Tab")
    );
  }

  private assertionLines(result: RunResult, lines: string[]): void {
    if (!result.assertions?.length) {
      lines.push(chalk.dim("  (no assertions on this request)"));
      return;
    }
    lines.push(`  ${chalk.dim("Assertions:")}`);
    for (const a of result.assertions) {
      const icon = a.passed ? chalk.green("✓") : chalk.red("✗");
      const detail = a.passed
        ? ""
        : chalk.dim(`  (expected: ${a.expected ?? ""}, got: ${a.actual ?? ""})`);
      lines.push(`  ${icon} ${a.name ?? a.rawExpr ?? ""}${detail}`);
    }
  }

  private captureLines(result: RunResult, lines: string[]): void {
    if (!result.capturedVars || Object.keys(result.capturedVars).length === 0) return;
    lines.push("");
    lines.push(`  ${chalk.dim("Captured:")}`);
    for (const [k, v] of Object.entries(result.capturedVars)) {
      lines.push(`  ${chalk.dim(`→ {{${k}}} = ${v}`)}`);
    }
  }

  /** Request definition (method, url, params, headers, body, assertions) — no network. */
  private requestDefLines(item: RequestItem, C: number): string[] {
    const lines: string[] = [];
    lines.push("");
    lines.push(`  ${chalk.dim("Method:")} ${methodStyle(item.method)(item.method)}`);
    lines.push(`  ${chalk.dim("URL:")} ${truncate(item.url, Math.max(8, C - 12))}`);
    if (item.queryParams?.length) {
      lines.push(`  ${chalk.dim("Query params:")}`);
      for (const qp of item.queryParams) {
        lines.push(`    ${chalk.dim(qp.key + " =")} ${truncate(qp.value, Math.max(4, C - 16))}`);
      }
    }
    if (item.headers && Object.keys(item.headers).length > 0) {
      lines.push(`  ${chalk.dim("Headers:")}`);
      for (const [k, v] of Object.entries(item.headers)) {
        lines.push(`    ${chalk.dim(k + ":")} ${truncate(v, Math.max(4, C - 16))}`);
      }
    }
    if (item.authType && item.authType !== "none") {
      lines.push(`  ${chalk.dim("Auth:")} ${item.authType}${item.authToken ? " (token set)" : ""}`);
    }
    if (item.method === "GRAPHQL" && item.graphql?.query) {
      lines.push(`  ${chalk.dim("GraphQL:")}`);
      for (const line of item.graphql.query.split("\n")) {
        lines.push(`    ${truncate(line, Math.max(4, C - 8))}`);
      }
    } else if (item.body) {
      lines.push(`  ${chalk.dim(`Body (${item.bodyType ?? "raw"}):`)}`);
      const bodyMax = Math.max(4, this.rows - lines.length - 6);
      for (const line of prettyBody(item.body, bodyMax).split("\n")) {
        lines.push(`    ${truncate(line, Math.max(4, C - 8))}`);
      }
    }
    if (item.assert?.length) {
      lines.push(`  ${chalk.dim("Assertions:")}`);
      for (const a of item.assert) {
        lines.push(`    ${chalk.dim("-")} ${a.name ?? a.expr ?? ""}`);
      }
    }
    if (item.capture?.length) {
      lines.push(`  ${chalk.dim("Captures:")}`);
      for (const c of item.capture) {
        lines.push(`    ${chalk.dim(`{{${c.name}}} ←`)} ${c.expr}`);
      }
    }
    return lines;
  }

  private envLines(): string[] {
    const envs = this.bundle.environments ?? [];
    const lines: string[] = [chalk.bold("  Select environment:")];
    if (envs.length === 0) {
      lines.push(chalk.dim("  No environments defined — add them to the bundle"));
      return lines;
    }
    envs.forEach((e, i) => {
      const sel = i === this.envIndex;
      const label = `${e.name}${chalk.dim(`  (${e.variables.filter((v) => v.enabled).length} enabled)`)}`;
      lines.push(`${sel ? chalk.cyanBright("▸ ") : "  "}${sel ? chalk.bold(label) : label}`);
    });
    return lines;
  }

  private helpLines(C: number): string[] {
    const shortcuts: Array<[string, string]> = [
      ["↑ / k", "up"],
      ["↓ / j", "down"],
      ["PgUp / PgDn", "page"],
      ["g / G", "top / bottom"],
      ["Enter", "run request"],
      ["Space / i", "inspect request"],
      ["b / h / a", "result tabs (detail)"],
      ["v", "view last result"],
      ["a", "run filtered"],
      ["e", "environments"],
      ["/", "search"],
      ["Esc", "cancel / back"],
      ["h", "help"],
      ["q", "quit"],
    ];
    const lines: string[] = [chalk.bold("  Keyboard shortcuts:")];
    for (let i = 0; i < shortcuts.length; i += 2) {
      const l = shortcuts[i]!;
      const r = shortcuts[i + 1];
      let row = `  ${chalk.cyan(l[0].padEnd(16))}${chalk.dim(l[1])}`;
      if (r) row += `  ${chalk.cyan(r[0].padEnd(16))}${chalk.dim(r[1])}`;
      lines.push(fitToCols(row, C));
    }
    lines.push("");
    lines.push(
      chalk.dim(
        `  ${this.bundle.collections[0]?.name ?? "Collection"} — ${this.requests.length} requests`,
      ),
    );
    return lines;
  }

  private barLine(C: number): string {
    const map: Record<Mode, string> = {
      list: "↑↓ move · / search · Space inspect · Enter run · a run · e env · h help · q quit",
      search: "type to filter · Esc close",
      inspect: "Enter run · n next · p prev · Esc back · q quit",
      detail: "b/h/a tabs · r rerun · n next · p prev · Esc back · q quit",
      env: "↑↓ move · Enter select · Esc cancel",
      help: "any key to close",
    };
    return fitToCols(chalk.dim(map[this.mode] ?? ""), C);
  }
}

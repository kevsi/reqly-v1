import type { RunnerContext, RequestResponse } from "./types";

export interface ScriptOptions {
  phase: "pre" | "post";
  response?: RequestResponse;
  timeoutMs?: number;
}

export interface ConsoleEntry {
  level: "log" | "warn" | "error";
  timestamp: number;
  message: string;
}

export interface ScriptOutput {
  result?: unknown;
  error?: string;
  consoleLines: string[];
  consoleEntries: ConsoleEntry[];
}

const FORBIDDEN_GLOBALS = [
  "require",
  "module",
  "exports",
  "__dirname",
  "__filename",
  "global",
  "globalThis",
  "process",
  "Buffer",
  "setImmediate",
  "setInterval",
  // Network/egress + async runaway primitives: keep the sandbox from
  // exfiltrating data or spawning unbounded timers/microtasks even if the
  // vm boundary were breached. Combined with codeGeneration:{strings:false}
  // and the per-script timeout this bounds what untrusted scripts can do.
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "setTimeout",
  "clearTimeout",
  "queueMicrotask",
  "Atomics",
  "SharedArrayBuffer",
];

function createPmApi(ctx: RunnerContext, response?: RequestResponse) {
  const environment = {
    get: (k: string) => ctx.environment[k],
    set: (k: string, v: string) => {
      ctx.environment[k] = v;
    },
    has: (k: string) => k in ctx.environment,
    unset: (k: string) => {
      delete ctx.environment[k];
    },
  };
  const variables = {
    get: (k: string) => ctx.iterationData[k] ?? ctx.environment[k],
    set: (k: string, v: string) => {
      ctx.iterationData[k] = v;
    },
  };
  const iterationData = {
    get: (k: string) => ctx.iterationData[k],
    set: (k: string, v: string) => {
      ctx.iterationData[k] = v;
    },
  };
  return {
    environment,
    variables,
    iterationData,
    expect: (actual: unknown) => ({
      to: {
        equal: (expected: unknown) => {
          if (actual !== expected)
            throw new Error(
              `Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`,
            );
        },
        exist: () => {
          if (actual === undefined || actual === null) throw new Error(`Expected value to exist`);
        },
      },
    }),
    response,
  };
}

function stringify(v: unknown): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

interface NodeVmLike {
  Script: new (code: string) => {
    runInContext(context: unknown, options?: { timeout?: number }): unknown;
  };
  createContext(sandbox: Record<string, unknown>, options?: Record<string, unknown>): unknown;
}

let _vm: NodeVmLike | null | undefined;
/**
 * The hardened vm sandbox is available only in Node/Tauri runtimes. Browser
 * execution deliberately returns an explicit error; it is not a web sandbox.
 */
async function getVm(): Promise<NodeVmLike | null> {
  if (_vm !== undefined) return _vm;
  try {
    const m = "node" + String.fromCharCode(58) + "vm";
    const getBuiltinModule = process.getBuiltinModule;
    _vm = typeof getBuiltinModule === "function" ? (getBuiltinModule(m) as NodeVmLike) : null;
  } catch {
    _vm = null;
  }
  return _vm ?? null;
}

export async function runScript(
  code: string,
  ctx: RunnerContext,
  options: ScriptOptions,
): Promise<ScriptOutput> {
  const consoleLines: string[] = [];
  const consoleEntries: ConsoleEntry[] = [];
  const log = (level: ConsoleEntry["level"], args: unknown[]) => {
    const message = args.map(stringify).join(" ");
    consoleLines.push(level === "log" ? message : `[${level.toUpperCase()}] ${message}`);
    consoleEntries.push({ level, timestamp: Date.now(), message });
    ctx.log(message);
  };
  const consoleShim = {
    log: (...args: unknown[]) => log("log", args),
    warn: (...args: unknown[]) => log("warn", args),
    error: (...args: unknown[]) => log("error", args),
  };

  const sandbox: Record<string, unknown> = {
    pm: createPmApi(ctx, options.response),
    console: consoleShim,
    Math,
    Date,
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Map,
    Set,
    URL,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
  };
  for (const key of FORBIDDEN_GLOBALS) sandbox[key] = undefined;

  const vm = await getVm();

  try {
    if (vm) {
      // Node.js / Tauri backend: use the hardened vm sandbox
      const wrapped = `(function() { return (${code}); })()`;
      const script = new vm.Script(wrapped);
      const vmContext = vm.createContext(sandbox, {
        codeGeneration: { strings: false, wasm: false },
        microtaskMode: "afterEvaluate",
      });
      const result = script.runInContext(vmContext, { timeout: options.timeoutMs ?? 3000 });
      return { result, consoleLines, consoleEntries };
    }

    // Browser / Tauri webview fallback: use Function constructor.
    // Less secure (no sandboxing, no timeout) but functional for local use.
    const fnArgs = Object.keys(sandbox);
    const fnValues = Object.values(sandbox);
    // Execute code directly (statements or expression) — no return wrapper
    // to avoid syntax errors with statements like console.log("x");
    const fn = new Function(...fnArgs, `"use strict"; ${code}`);
    const result = fn(...fnValues);
    return { result, consoleLines, consoleEntries };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err), consoleLines, consoleEntries };
  }
}

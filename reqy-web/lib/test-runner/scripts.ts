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
  // Compat layer: Postman-like `pm.response.code/status` + Reqly `statusCode`
  // Les scripts existants utilisent `pm.response.code` (placeholder = pm.expect(pm.response.code).to.equal(200))
  // alors que RequestResponse expose `statusCode`. On aliase tout.
  let pmResponse: Record<string, unknown> | undefined;
  if (response) {
    const bodyStr = typeof response.body === "string" ? response.body : JSON.stringify(response.body ?? "");
    const statusCode = (response as RequestResponse).statusCode ?? 0;
    const base: Record<string, unknown> = {
      statusCode,
      code: statusCode,
      status: statusCode,
      responseTime: response.responseTimeMs,
      responseTimeMs: response.responseTimeMs,
      headers: response.headers,
      body: bodyStr,
      data: response.body,
      json: response.body,
    };
    // Proxy headers en lower-case helper
    pmResponse = new Proxy(base, {
      get(target, prop: string) {
        if (prop in target) return target[prop as keyof typeof target];
        if (typeof prop === "string") {
          const lower = prop.toLowerCase();
          if (lower in target) return target[lower as keyof typeof target];
          // header lookup shortcut: pm.response.headers['content-type']
          if (target.headers && typeof target.headers === "object") {
            const h = (target.headers as Record<string, string>)[prop];
            if (h !== undefined) return h;
            const found = Object.entries(target.headers as Record<string, string>).find(
              ([k]) => k.toLowerCase() === lower,
            );
            if (found) return found[1];
          }
        }
        return undefined;
      },
    });
  }
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
    response: pmResponse ?? response,
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
      // On tente d'abord en mode expression (retourne valeur pour les tests unitaires comme pm.environment.get(...))
      // puis fallback en mode statements (multi-instructions comme pm.expect(...); pm.environment.set(...))
      const isStatementLike = code.includes(";") || code.includes("\n");
      const candidates = isStatementLike
        ? [`(function(){ ${code} })()`, `(function(){ return (${code}) })()`]
        : [`(function(){ return (${code}) })()`, `(function(){ ${code} })()`];
      let lastError: unknown;
      for (const wrapped of candidates) {
        try {
          const script = new vm.Script(wrapped);
          const vmContext = vm.createContext(sandbox, {
            codeGeneration: { strings: false, wasm: false },
            microtaskMode: "afterEvaluate",
          });
          const result = script.runInContext(vmContext, { timeout: options.timeoutMs ?? 3000 });
          return { result, consoleLines, consoleEntries };
        } catch (e) {
          lastError = e;
          if (e instanceof SyntaxError || (e as Error).message?.includes("SyntaxError")) continue;
          throw e;
        }
      }
      throw lastError;
    }

    // Browser / Tauri webview fallback: execution is explicitly disabled.
    // The hardened vm sandbox is only available in Node/Tauri runtimes; falling
    // back to Function would be insecure (no timeout, no codeGeneration guard).
    return {
      error:
        "Exécution de scripts désactivée dans le navigateur : utilisez l'application desktop Tauri pour exécuter les scripts pre/post.",
      consoleLines,
      consoleEntries,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err), consoleLines, consoleEntries };
  }
}

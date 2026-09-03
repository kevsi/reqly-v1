/**
 * @deprecated Uniquement importé par `lib/script-executor.ts` (lui-même deprecated).
 * Ne pas utiliser dans de nouveau code. Conservé pour la route
 * `/api/test-runner/execute` (couverte par les specs e2e), car le moteur canonique
 * `lib/test-runner/` n'exécute pas de scripts côté serveur. Le contexte sandbox
 * est durci pour refléter la politique FORBIDDEN_GLOBALS du moteur canonique.
 *
 * Script Sandbox - VM-based script execution for safe script execution
 * Provides isolated execution environment with timeout and memory limits
 */

import vm from "vm";

export interface ScriptContext {
  pm?: {
    environment: Record<string, string | number | boolean>;
  };
  request?: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: string;
  };
  response?: {
    status: number;
    headers: Record<string, string>;
    body: string;
  };
  console?: {
    log: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
  };
}

export interface ScriptResult {
  success: boolean;
  result?: unknown;
  output?: string;
  error?: string;
  duration: number;
  logs?: string[];
}

/**
 * Execute script in isolated VM context with timeout and memory limits
 * @param scriptCode - JavaScript code to execute
 * @param context - Execution context (pm.environment, request, response)
 * @param timeoutMs - Timeout in milliseconds (default 5000)
 * @returns Script execution result
 */
export async function executeScriptInSandbox(
  scriptCode: string,
  context: ScriptContext = {},
  timeoutMs: number = 5000,
): Promise<ScriptResult> {
  const startTime = Date.now();
  const logs: string[] = [];

  return new Promise((resolve) => {
    try {
      // Build sandbox context
      const sandboxContext = buildSandboxContext(context, logs);

      // Create VM context
      const vmContext = vm.createContext(sandboxContext, {
        codeGeneration: { strings: false, wasm: false },
        microtaskMode: "afterEvaluate",
      });

      // Execute with timeout
      const script = new vm.Script(scriptCode);

      // Run with timeout
      try {
        const result = script.runInContext(vmContext, {
          timeout: timeoutMs,
          displayErrors: true,
        });

        resolve({
          success: true,
          result,
          output: "Script executed successfully",
          duration: Date.now() - startTime,
          logs,
        });
      } catch (error) {
        // Check if it's a timeout error
        if ((error as { code?: string }).code === "ERR_SCRIPT_EXECUTION_TIMEOUT") {
          resolve({
            success: false,
            error: `Script execution timeout (${timeoutMs}ms)`,
            duration: Date.now() - startTime,
            logs,
          });
        } else {
          const errorMessage = error instanceof Error ? error.message : String(error);
          resolve({
            success: false,
            error: `Execution error: ${errorMessage}`,
            duration: Date.now() - startTime,
            logs,
          });
        }
      }
    } catch (error) {
      resolve({
        success: false,
        error: `Failed to create sandbox: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - startTime,
        logs,
      });
    }
  });
}

/**
 * Globals explicitly shadowed to `undefined` inside the sandbox, mirroring the
 * canonical engine policy in lib/test-runner/scripts.ts (FORBIDDEN_GLOBALS):
 * no dynamic code escape hatches, no shared-memory/timer primitives, and no
 * network/egress APIs even if the vm boundary were breached.
 */
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
  "child_process",
  "fs",
  "eval",
  "Function",
  "Proxy",
  "Reflect",
  "WeakRef",
  "FinalizationRegistry",
  "SharedArrayBuffer",
  "Atomics",
  "queueMicrotask",
  "setImmediate",
  "setInterval",
  "setTimeout",
  "clearTimeout",
  "clearImmediate",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "importScripts",
];

/**
 * Build safe sandbox context with restricted APIs
 */
/** Safe stringify: never throws on circular structures logged by user code. */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function buildSandboxContext(context: ScriptContext, logs: string[]) {
  const consoleProxy = {
    log: (...args: unknown[]) => {
      logs.push(args.map(safeStringify).join(" "));
    },
    error: (...args: unknown[]) => {
      logs.push(`ERROR: ${args.map(safeStringify).join(" ")}`);
    },
    warn: (...args: unknown[]) => {
      logs.push(`WARN: ${args.map(safeStringify).join(" ")}`);
    },
  };

  const sandboxContext: Record<string, unknown> = {
    // Provide safe APIs
    pm: {
      environment: context.pm?.environment || {},
    },
    request: context.request || {},
    response: context.response || {},
    console: consoleProxy,

    // Math, JSON and other intrinsics needed for legitimate assertion scripts
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Date,
    RegExp,
    Error,
    Set,
    Map,
    Promise,
  };

  for (const key of FORBIDDEN_GLOBALS) sandboxContext[key] = undefined;

  return sandboxContext;
}

/**
 * Execute multiple scripts sequentially with pre/post script support
 */
/** Placeholder result used when a script stage is skipped after a failure. */
function skippedResult(): ScriptResult {
  return { success: false, error: "Skipped: an earlier script in the sequence failed.", duration: 0, logs: [] };
}

export async function executeScriptSequence(
  preScript: string | null,
  mainScript: string,
  postScript: string | null,
  context: ScriptContext = {},
  timeoutMs: number = 5000,
): Promise<{
  preResult?: ScriptResult;
  mainResult: ScriptResult;
  postResult?: ScriptResult;
}> {
  let preResult: ScriptResult | undefined;
  // Execute pre-script if provided
  if (preScript) {
    preResult = await executeScriptInSandbox(preScript, context, timeoutMs);
    if (!preResult.success) {
      // Stop on pre-script failure; main/post never ran.
      return { preResult, mainResult: skippedResult() };
    }
  }

  // Execute main script
  const mainResult = await executeScriptInSandbox(mainScript, context, timeoutMs);
  if (!mainResult.success) {
    // Stop on main script failure; post never ran.
    return { mainResult };
  }

  // Execute post-script if provided
  const postResult = postScript
    ? await executeScriptInSandbox(postScript, context, timeoutMs)
    : undefined;

  return { preResult, mainResult, postResult };
}

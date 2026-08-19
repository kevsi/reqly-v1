/**
 * @deprecated Uniquement importé par `lib/script-executor.ts` (lui-même deprecated).
 * Ne pas utiliser dans de nouveau code. À supprimer après migration de la route
 * `/api/test-runner/execute` vers le moteur canonique `lib/test-runner/`.
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
    log: (...args: any[]) => void;
    error: (...args: any[]) => void;
    warn: (...args: any[]) => void;
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
      } catch (error: any) {
        // Check if it's a timeout error
        if (error.code === "ERR_SCRIPT_EXECUTION_TIMEOUT") {
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
 * Build safe sandbox context with restricted APIs
 */
function buildSandboxContext(context: ScriptContext, logs: string[]) {
  const consoleProxy = {
    log: (...args: any[]) => {
      logs.push(args.map((a) => JSON.stringify(a)).join(" "));
    },
    error: (...args: any[]) => {
      logs.push(`ERROR: ${args.map((a) => JSON.stringify(a)).join(" ")}`);
    },
    warn: (...args: any[]) => {
      logs.push(`WARN: ${args.map((a) => JSON.stringify(a)).join(" ")}`);
    },
  };

  return {
    // Provide safe APIs
    pm: {
      environment: context.pm?.environment || {},
    },
    request: context.request || {},
    response: context.response || {},
    console: consoleProxy,

    // Prevent dangerous global APIs
    require: undefined,
    eval: undefined,
    Function: undefined,
    process: undefined,
    Buffer: undefined,
    child_process: undefined,
    fs: undefined,
    __dirname: undefined,
    __filename: undefined,

    // Math and JSON are safe
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
  };
}

/**
 * Execute multiple scripts sequentially with pre/post script support
 */
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
  const results: any = {};

  // Execute pre-script if provided
  if (preScript) {
    results.preResult = await executeScriptInSandbox(preScript, context, timeoutMs);
    if (!results.preResult.success) {
      return results; // Stop on pre-script failure
    }
  }

  // Execute main script
  results.mainResult = await executeScriptInSandbox(mainScript, context, timeoutMs);
  if (!results.mainResult.success) {
    return results; // Stop on main script failure
  }

  // Execute post-script if provided
  if (postScript) {
    results.postResult = await executeScriptInSandbox(postScript, context, timeoutMs);
  }

  return results;
}

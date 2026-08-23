/**
 * @deprecated Ce module n'est plus appelé depuis l'UI React.
 * Son unique consommateur actif est `app/api/test-runner/execute/route.ts`,
 * qui est testé uniquement par des specs e2e (tests/e2e/scripts-assertions.spec.ts).
 * Le moteur canonique est `lib/test-runner/runner.ts` + `lib/test-runner/assertions.ts`,
 * mais il n'exécute pas de scripts côté serveur (`disableScripts: true`) : ce module
 * est conservé pour la couverture e2e, sur un sandbox durci (FORBIDDEN_GLOBALS).
 *
 * Script Executor - High-level API for executing test scripts with assertions
 * Supports pre/post scripts, assertions, and data-driven testing
 */

import { executeScriptInSandbox, executeScriptSequence, ScriptContext } from "./script-sandbox";

export interface TestScriptDefinition {
  name: string;
  preScript?: string;
  testScript: string;
  postScript?: string;
  variables?: Record<string, string | number | boolean>;
  assertions?: AssertionDefinition[];
  timeout?: number;
}

export interface AssertionDefinition {
  type: "statusCode" | "bodyContains" | "headerExists" | "jsonPath" | "custom";
  value: string | number;
  message?: string;
}

export interface TestScriptExecution {
  name: string;
  success: boolean;
  duration: number;
  scriptOutput?: string;
  scriptError?: string;
  assertions: {
    total: number;
    passed: number;
    failed: number;
    results: AssertionResult[];
  };
  logs: string[];
}

export interface AssertionResult {
  type: string;
  value: string | number;
  passed: boolean;
  message?: string;
  error?: string;
}

/**
 * Execute a single test script with assertions
 */
export async function executeTestScript(
  definition: TestScriptDefinition,
  request: unknown,
  response: unknown,
): Promise<TestScriptExecution> {
  const timeout = definition.timeout || 5000;
  const startTime = Date.now();

  // Build context with variables
  const context: ScriptContext = {
    pm: {
      environment: {
        ...definition.variables,
      },
    },
    request: request as ScriptContext["request"],
    response: response as ScriptContext["response"],
  };

  // Execute scripts
  const results = await executeScriptSequence(
    definition.preScript || null,
    definition.testScript,
    definition.postScript || null,
    context,
    timeout,
  );

  const mainResult = results.mainResult;
  const duration = Date.now() - startTime;

  // Execute assertions
  const assertions = await executeAssertions(
    definition.assertions || [],
    response as ScriptContext["response"] | undefined,
    context,
  );

  return {
    name: definition.name,
    success: mainResult.success && assertions.passed === assertions.total,
    duration,
    scriptOutput: mainResult.success ? "Script executed" : undefined,
    scriptError: mainResult.error,
    assertions: {
      total: assertions.total,
      passed: assertions.passed,
      failed: assertions.total - assertions.passed,
      results: assertions.results,
    },
    logs: mainResult.logs || [],
  };
}

/**
 * Execute multiple test scripts
 */
export async function executeTestScripts(
  definitions: TestScriptDefinition[],
  request: unknown,
  response: unknown,
): Promise<TestScriptExecution[]> {
  const results = await Promise.all(
    definitions.map((def) => executeTestScript(def, request, response)),
  );

  return results;
}

/**
 * Execute assertions against response
 */
async function executeAssertions(
  assertions: AssertionDefinition[],
  response: ScriptContext["response"] | undefined,
  context: ScriptContext,
): Promise<{
  total: number;
  passed: number;
  results: AssertionResult[];
}> {
  const results: AssertionResult[] = [];
  let passed = 0;

  for (const assertion of assertions) {
    const result = await evaluateAssertion(assertion, response, context);
    results.push(result);
    if (result.passed) passed++;
  }

  return {
    total: assertions.length,
    passed,
    results,
  };
}

/**
 * Evaluate a single assertion
 */
async function evaluateAssertion(
  assertion: AssertionDefinition,
  response: ScriptContext["response"] | undefined,
  context: ScriptContext,
): Promise<AssertionResult> {
  try {
    let passed = false;
    let error: string | undefined;

    switch (assertion.type) {
      case "statusCode": {
        const expected = Number(assertion.value);
        passed = response?.status === expected;
        error = passed ? undefined : `Expected status ${expected}, got ${response?.status}`;
        break;
      }

      case "bodyContains": {
        const searchString = String(assertion.value);
        const body = response?.body || "";
        passed = body.includes(searchString);
        error = passed ? undefined : `Body does not contain "${searchString}"`;
        break;
      }

      case "headerExists": {
        const headerName = String(assertion.value).toLowerCase();
        const headers = response?.headers || {};
        passed = Object.keys(headers).some((h) => h.toLowerCase() === headerName);
        error = passed ? undefined : `Header "${assertion.value}" not found`;
        break;
      }

      case "jsonPath": {
        try {
          const body = JSON.parse(response?.body || "{}");
          const path = String(assertion.value);
          const value = getJsonPath(body, path);
          passed = value !== undefined;
          error = passed ? undefined : `JSONPath "${path}" not found`;
        } catch (e) {
          passed = false;
          error = `Invalid JSON in response: ${e instanceof Error ? e.message : String(e)}`;
        }
        break;
      }

      case "custom": {
        const scriptCode = String(assertion.value);
        const result = await executeScriptInSandbox(scriptCode, {
          pm: context.pm,
          response,
        });
        passed = result.success && Boolean(result.result);
        error = passed ? undefined : result.error || "Custom assertion failed";
        break;
      }
    }

    return {
      type: assertion.type,
      value: assertion.value,
      passed,
      message: assertion.message,
      error,
    };
  } catch (error) {
    return {
      type: assertion.type,
      value: assertion.value,
      passed: false,
      message: assertion.message,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Navigate JSON path (e.g., "data.user.name")
 */
function getJsonPath(obj: unknown, path: string): unknown {
  const keys = path.split(".");
  let current: unknown = obj;

  for (const key of keys) {
    if (current == null) return undefined;
    // Anti-prototype-pollution : ne jamais suivre __proto__/constructor/prototype
    if (key === "__proto__" || key === "constructor" || key === "prototype") return undefined;
    current = (current as Record<string, unknown>)[key];
  }

  return current;
}

/**
 * Parse assertions from test script
 * Support format: "// ASSERT: statusCode === 200"
 */
export function parseAssertionsFromScript(scriptCode: string): AssertionDefinition[] {
  const assertions: AssertionDefinition[] = [];
  const lines = scriptCode.split("\n");

  for (const line of lines) {
    if (line.includes("// ASSERT:")) {
      const match = line.match(/\/\/\s*ASSERT:\s*(.+)/);
      if (match) {
        const assertionCode = match[1].trim();
        // Parse simple assertions like "statusCode === 200"
        if (assertionCode.includes("===")) {
          const [left, right] = assertionCode.split("===").map((s) => s.trim());
          assertions.push({
            type: left as AssertionDefinition["type"],
            value: right.replace(/['"]/g, ""),
            message: `Assert ${left} === ${right}`,
          });
        }
      }
    }
  }

  return assertions;
}

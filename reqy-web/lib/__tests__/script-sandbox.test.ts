/**
 * Tests for Script Sandbox execution
 */

import { describe, it, expect } from "vitest";
import { executeScriptInSandbox, executeScriptSequence } from "@/lib/script-sandbox";
import {
  executeTestScript,
  parseAssertionsFromScript,
  TestScriptDefinition,
} from "@/lib/script-executor";

describe("Script Sandbox", () => {
  describe("executeScriptInSandbox", () => {
    it("should execute simple script", async () => {
      const result = await executeScriptInSandbox('console.log("hello")');
      expect(result.success).toBe(true);
      expect(result.duration).toBeLessThan(1000);
    });

    it("should execute script with environment variables", async () => {
      const result = await executeScriptInSandbox(
        'const x = pm.environment.TEST_VAR; if (x !== "test") throw new Error("Variable not found");',
        {
          pm: {
            environment: { TEST_VAR: "test" },
          },
        },
      );
      expect(result.success).toBe(true);
    });

    it("should handle script errors gracefully", async () => {
      const result = await executeScriptInSandbox('throw new Error("Script failed")');
      expect(result.success).toBe(false);
      expect(result.error).toContain("Script failed");
    });

    it("should timeout on infinite loop", async () => {
      const result = await executeScriptInSandbox("while(true) {}", {}, 500);
      expect(result.success).toBe(false);
      expect(result.error).toContain("timeout");
      expect(result.duration).toBeGreaterThanOrEqual(500);
    });

    it("should prevent filesystem access (fs module)", async () => {
      const result = await executeScriptInSandbox(
        'const fs = require("fs"); fs.readFileSync("/etc/passwd");',
      );
      expect(result.success).toBe(false);
      // Worker should error or timeout trying to access
    });

    it("should prevent child process spawning", async () => {
      const result = await executeScriptInSandbox(
        'const { spawn } = require("child_process"); spawn("cat", ["/etc/passwd"]);',
      );
      expect(result.success).toBe(false);
    });

    it("should access request/response context", async () => {
      const result = await executeScriptInSandbox(
        'if (request.method !== "GET") throw new Error("Request not accessible");',
        {
          request: { method: "GET", url: "http://example.com" },
        },
      );
      expect(result.success).toBe(true);
    });

    it("should access response context", async () => {
      const result = await executeScriptInSandbox(
        'if (response.status !== 200) throw new Error("Status check failed");',
        {
          response: { status: 200, body: "OK" },
        },
      );
      expect(result.success).toBe(true);
    });
  });

  describe("Hardened globals (FORBIDDEN_GLOBALS policy)", () => {
    const hardenedGlobals = [
      "Proxy",
      "Reflect",
      "WeakRef",
      "FinalizationRegistry",
      "SharedArrayBuffer",
      "Atomics",
      "globalThis",
      "global",
      "process",
      "Buffer",
      "require",
      "module",
      "exports",
      "__dirname",
      "__filename",
      "eval",
      "Function",
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

    for (const globalName of hardenedGlobals) {
      it(`should not expose ${globalName} inside executed scripts`, async () => {
        const result = await executeScriptInSandbox(`typeof ${globalName};`);
        expect(result.success).toBe(true);
        expect(result.result).toBe("undefined");
      });
    }

    it("should keep Promise and Math available for legitimate scripts", async () => {
      const result = await executeScriptInSandbox(
        'if (typeof Promise !== "function") throw new Error("Promise missing"); if (Math.max(1, 2) !== 2) throw new Error("Math missing"); true;',
      );
      expect(result.success).toBe(true);
    });
  });

  describe("executeScriptSequence", () => {
    it("should execute pre, main, and post scripts in order", async () => {
      const results = await executeScriptSequence(
        'console.log("pre");',
        'console.log("main");',
        'console.log("post");',
      );

      expect(results.preResult?.success).toBe(true);
      expect(results.mainResult.success).toBe(true);
      expect(results.postResult?.success).toBe(true);
    });

    it("should stop execution if pre-script fails", async () => {
      const results = await executeScriptSequence(
        'throw new Error("Pre failed");',
        'console.log("main");',
        'console.log("post");',
      );

      expect(results.preResult?.success).toBe(false);
      expect(results.mainResult).toBeUndefined();
      expect(results.postResult).toBeUndefined();
    });

    it("should execute without pre-script if not provided", async () => {
      const results = await executeScriptSequence(null, 'console.log("main");', null);

      expect(results.preResult).toBeUndefined();
      expect(results.mainResult.success).toBe(true);
      expect(results.postResult).toBeUndefined();
    });
  });

  describe("executeTestScript", () => {
    it("should execute test script with assertions", async () => {
      const definition: TestScriptDefinition = {
        name: "Test Example",
        testScript: 'console.log("test");',
        assertions: [
          {
            type: "statusCode",
            value: 200,
          },
        ],
      };

      const result = await executeTestScript(definition, {}, { status: 200, body: "OK" });
      expect(result.success).toBe(true);
      expect(result.assertions.passed).toBe(1);
    });

    it("should handle status code assertions", async () => {
      const definition: TestScriptDefinition = {
        name: "Status Check",
        testScript: 'console.log("checking status");',
        assertions: [
          {
            type: "statusCode",
            value: 200,
            message: "Status should be 200",
          },
        ],
      };

      const result = await executeTestScript(definition, {}, { status: 200 });
      expect(result.assertions.passed).toBe(1);
      expect(result.assertions.results[0].passed).toBe(true);
    });

    it("should handle bodyContains assertions", async () => {
      const definition: TestScriptDefinition = {
        name: "Body Check",
        testScript: 'console.log("checking body");',
        assertions: [
          {
            type: "bodyContains",
            value: "success",
          },
        ],
      };

      const result = await executeTestScript(
        definition,
        {},
        { status: 200, body: "Operation was a success" },
      );
      expect(result.assertions.passed).toBe(1);
    });

    it("should handle headerExists assertions", async () => {
      const definition: TestScriptDefinition = {
        name: "Header Check",
        testScript: 'console.log("checking headers");',
        assertions: [
          {
            type: "headerExists",
            value: "content-type",
          },
        ],
      };

      const result = await executeTestScript(
        definition,
        {},
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
      expect(result.assertions.passed).toBe(1);
    });

    it("should handle jsonPath assertions", async () => {
      const definition: TestScriptDefinition = {
        name: "JSON Check",
        testScript: 'console.log("checking json");',
        assertions: [
          {
            type: "jsonPath",
            value: "data.user.id",
          },
        ],
      };

      const response = {
        status: 200,
        body: JSON.stringify({ data: { user: { id: 123 } } }),
      };

      const result = await executeTestScript(definition, {}, response);
      expect(result.assertions.passed).toBe(1);
    });

    it("should handle custom assertions", async () => {
      const definition: TestScriptDefinition = {
        name: "Custom Check",
        testScript: 'console.log("running custom");',
        assertions: [
          {
            type: "custom",
            value: "response.status === 200",
          },
        ],
      };

      const result = await executeTestScript(definition, {}, { status: 200 });
      expect(result.assertions.passed).toBe(1);
    });

    it("should isolate custom assertions from the Node process", async () => {
      const definition: TestScriptDefinition = {
        name: "Sandboxed Custom Check",
        testScript: "true;",
        assertions: [
          {
            type: "custom",
            value: 'typeof process === "undefined"',
          },
        ],
      };

      const result = await executeTestScript(definition, {}, { status: 200 });
      expect(result.assertions.passed).toBe(1);
    });

    it("should support pre-scripts for setup", async () => {
      const definition: TestScriptDefinition = {
        name: "Setup Test",
        preScript: "pm.environment.counter = 0;",
        testScript: "pm.environment.counter++;",
        assertions: [],
      };

      const result = await executeTestScript(definition, {}, {});
      expect(result.success).toBe(true);
    });

    it("should support post-scripts for cleanup", async () => {
      const definition: TestScriptDefinition = {
        name: "Cleanup Test",
        testScript: 'console.log("main");',
        postScript: 'console.log("cleanup");',
        assertions: [],
      };

      const result = await executeTestScript(definition, {}, {});
      expect(result.success).toBe(true);
    });

    it("should respect timeout setting", async () => {
      const definition: TestScriptDefinition = {
        name: "Timeout Test",
        testScript: "while(true) {}",
        timeout: 300, // 300ms timeout
        assertions: [],
      };

      const result = await executeTestScript(definition, {}, {});
      expect(result.success).toBe(false);
      expect(result.scriptError).toContain("timeout");
    });

    it("should pass variables to script context", async () => {
      const definition: TestScriptDefinition = {
        name: "Variables Test",
        testScript: 'if (pm.environment.API_KEY !== "secret") throw new Error("Variable missing");',
        variables: {
          API_KEY: "secret",
          BASE_URL: "http://api.example.com",
        },
        assertions: [],
      };

      const result = await executeTestScript(definition, {}, {});
      expect(result.success).toBe(true);
    });

    it("should fail test if assertions fail", async () => {
      const definition: TestScriptDefinition = {
        name: "Failed Assertion",
        testScript: 'console.log("running");',
        assertions: [
          {
            type: "statusCode",
            value: 200,
          },
          {
            type: "statusCode",
            value: 201,
          },
        ],
      };

      const result = await executeTestScript(definition, {}, { status: 200 });
      expect(result.success).toBe(false);
      expect(result.assertions.passed).toBe(1);
      expect(result.assertions.failed).toBe(1);
    });
  });

  describe("parseAssertionsFromScript", () => {
    it("should parse assertions from script comments", () => {
      const script = `
        console.log("test");
        // ASSERT: statusCode === 200
        // ASSERT: bodyContains === success
      `;

      const assertions = parseAssertionsFromScript(script);
      expect(assertions.length).toBeGreaterThan(0);
    });

    it("should handle empty script", () => {
      const assertions = parseAssertionsFromScript("");
      expect(assertions).toEqual([]);
    });
  });

  describe("Security Tests", () => {
    it("should prevent access to process.exit()", async () => {
      const result = await executeScriptInSandbox("process.exit(1);");
      expect(result.success).toBe(false);
    });

    it("should prevent access to global object pollution", async () => {
      const result = await executeScriptInSandbox('global.malicious = "code"; require = null;');
      expect(result.success).toBe(false);
    });

    it("should prevent require() in sandbox", async () => {
      const result = await executeScriptInSandbox('const http = require("http");');
      expect(result.success).toBe(false);
    });

    it("should limit execution time to prevent DOS", async () => {
      const start = Date.now();
      const result = await executeScriptInSandbox("for(let i=0; i<1000000000; i++) {}", {}, 200);
      const duration = Date.now() - start;

      expect(result.success).toBe(false);
      expect(duration).toBeLessThan(500); // Should exit quickly after timeout
    });
  });
});

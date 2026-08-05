import { describe, it, expect, beforeEach } from "vitest";
import { createScriptContext, executeScript, ScriptError } from "./scripting.js";
import type { RunnerContext, RequestItem, RunResult } from "./types.js";

function makeCtx(): RunnerContext {
  const envVars = new Map<string, string>([["API_KEY", "secret123"]]);
  return { vars: new Map(), envVars, cookies: new Map(), iteration: 0, data: {} };
}

function makeRequest(overrides: Partial<RequestItem> = {}): RequestItem {
  return {
    name: "test",
    method: "GET",
    url: "https://api.example.com/users",
    endpoint: "/users",
    ...overrides,
  };
}

function makeResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    name: "test",
    method: "GET",
    url: "https://api.example.com/users",
    status: 200,
    statusText: "OK",
    durationMs: 100,
    size: 50,
    passed: true,
    body: JSON.stringify({ id: 1, name: "John", email: "john@test.com" }),
    responseHeaders: { "content-type": "application/json" },
    responseCookies: { session: "abc" },
    timestamp: Date.now(),
    ...overrides,
  };
}

/** Minimal Response-shaped stub for injected fetchFn. */
function stubFetch(
  status = 200,
  body = '{"ok":true}',
  headerEntries: Array<[string, string]> = [["content-type", "application/json"]],
): typeof fetch {
  const res = {
    status,
    statusText: "OK",
    headers: { entries: () => headerEntries[Symbol.iterator]() },
    text: async () => body,
  };
  return (async () => res) as unknown as typeof fetch;
}

describe("scripting", () => {
  describe("createScriptContext", () => {
    it("creates context with env API", () => {
      const ctx = makeCtx();
      const sc = createScriptContext(ctx, makeRequest());
      expect(sc.env.get("API_KEY")).toBe("secret123");
      sc.env.set("NEW_KEY", "value");
      expect(ctx.envVars.get("NEW_KEY")).toBe("value");
      sc.env.unset("API_KEY");
      expect(ctx.envVars.has("API_KEY")).toBe(false);
    });

    it("creates context with vars API", () => {
      const ctx = makeCtx();
      ctx.vars.set("userId", "42");
      const sc = createScriptContext(ctx, makeRequest());
      expect(sc.vars.get("userId")).toBe("42");
      sc.vars.set("token", "abc");
      expect(ctx.vars.get("token")).toBe("abc");
      sc.vars.unset("userId");
      expect(ctx.vars.has("userId")).toBe(false);
    });

    it("creates context with request API", () => {
      const sc = createScriptContext(makeCtx(), makeRequest());
      expect(sc.request.method).toBe("GET");
      expect(sc.request.url).toBe("https://api.example.com/users");
      sc.request.setHeader("X-Test", "value");
      sc.request.setUrl("https://other.com");
      sc.request.setMethod("POST");
      sc.request.setBody('{"test":true}');
    });

    it("includes response API when result is provided", () => {
      const result = makeResult({ body: '{"id":1}' });
      const sc = createScriptContext(makeCtx(), makeRequest(), result);
      expect(sc.response).toBeDefined();
      expect(sc.response!.status).toBe(200);
      expect(sc.response!.json()).toEqual({ id: 1 });
      expect(sc.response!.text()).toBe('{"id":1}');
      expect(sc.response!.cookies).toEqual({ session: "abc" });
    });

    it("does not include response API when result is not provided", () => {
      const sc = createScriptContext(makeCtx(), makeRequest());
      expect(sc.response).toBeUndefined();
    });
  });

  describe("executeScript", () => {
    describe("pre-request scripts", () => {
      it("executes a simple script", async () => {
        const ctx = makeCtx();
        const sc = createScriptContext(ctx, makeRequest());
        await executeScript('vars.set("test", "hello")', sc, "pre");
        expect(ctx.vars.get("test")).toBe("hello");
      });

      it("modifies request via API", async () => {
        const req = makeRequest();
        const sc = createScriptContext(makeCtx(), req);
        await executeScript(
          'request.setMethod("POST"); request.setUrl("https://other.com")',
          sc,
          "pre",
        );
        expect(req.method).toBe("POST");
        expect(req.url).toBe("https://other.com");
      });

      it("reads env variables", async () => {
        const ctx = makeCtx();
        ctx.envVars.set("BASE_URL", "https://api.example.com");
        const sc = createScriptContext(ctx, makeRequest());
        await executeScript('vars.set("url", env.get("BASE_URL"))', sc, "pre");
        expect(ctx.vars.get("url")).toBe("https://api.example.com");
      });

      it("handles script errors gracefully", async () => {
        const sc = createScriptContext(makeCtx(), makeRequest());
        await expect(executeScript('throw new Error("boom")', sc, "pre")).rejects.toThrow(
          ScriptError,
        );
      });

      it("ignores empty or whitespace scripts", async () => {
        const sc = createScriptContext(makeCtx(), makeRequest());
        await expect(executeScript("", sc, "pre")).resolves.toEqual({ tests: [] });
        await expect(executeScript("   ", sc, "pre")).resolves.toEqual({ tests: [] });
      });
    });

    describe("post-response scripts", () => {
      it("asserts response status", async () => {
        const result = makeResult({ status: 200 });
        const sc = createScriptContext(makeCtx(), makeRequest(), result);
        await executeScript("expect(response.status).toBe(200)", sc, "post");
      });

      it("fails on wrong status", async () => {
        const result = makeResult({ status: 404 });
        const sc = createScriptContext(makeCtx(), makeRequest(), result);
        await expect(
          executeScript("expect(response.status).toBe(200)", sc, "post"),
        ).rejects.toThrow(ScriptError);
      });

      it("accesses response body via json()", async () => {
        const result = makeResult({ body: '{"id":1,"name":"John"}' });
        const sc = createScriptContext(makeCtx(), makeRequest(), result);
        await executeScript(
          `
          const data = response.json()
          expect(data.id).toBe(1)
          expect(data.name).toBe("John")
        `,
          sc,
          "post",
        );
      });

      it("sets env vars from response", async () => {
        const ctx = makeCtx();
        const result = makeResult({ body: '{"token":"abc123"}' });
        const sc = createScriptContext(ctx, makeRequest(), result);
        await executeScript('const d = response.json(); env.set("TOKEN", d.token)', sc, "post");
        expect(ctx.envVars.get("TOKEN")).toBe("abc123");
      });

      it("uses expect().toContain()", async () => {
        const result = makeResult({ body: '{"name":"John Doe"}' });
        const sc = createScriptContext(makeCtx(), makeRequest(), result);
        await executeScript(
          'const d = response.json(); expect(d.name).toContain("John")',
          sc,
          "post",
        );
      });

      it("uses expect().toBeGreaterThan() and toBeLessThan()", async () => {
        const result = makeResult({ status: 200 });
        const sc = createScriptContext(makeCtx(), makeRequest(), result);
        await executeScript(
          "expect(response.status).toBeGreaterThan(199); expect(response.status).toBeLessThan(300)",
          sc,
          "post",
        );
      });

      it("uses expect().toMatch()", async () => {
        const result = makeResult({ status: 200 });
        const sc = createScriptContext(makeCtx(), makeRequest(), result);
        await executeScript("expect(response.statusText).toMatch(/^OK$/)", sc, "post");
      });
    });

    describe("pm.test + pm.expect (chai-lite)", () => {
      it("collects passing and failing pm.test results without throwing", async () => {
        const result = makeResult({ status: 200 });
        const sc = createScriptContext(makeCtx(), makeRequest(), result);
        const outcome = await executeScript(
          `
          pm.test("status is 200", () => pm.expect(pm.response.code).to.equal(200))
          pm.test("status is 404", () => pm.expect(pm.response.code).to.equal(404))
        `,
          sc,
          "post",
        );
        expect(outcome.tests).toHaveLength(2);
        expect(outcome.tests[0]).toMatchObject({ name: "status is 200", passed: true });
        expect(outcome.tests[1].passed).toBe(false);
        expect(outcome.tests[1].error).toContain("expected 404");
      });

      it("supports deep equal, property, include and match", async () => {
        const result = makeResult({ body: '{"user":{"name":"John"},"tags":["a","b"]}' });
        const sc = createScriptContext(makeCtx(), makeRequest(), result);
        const outcome = await executeScript(
          `
          const d = pm.response.json()
          pm.test("deep equal", () => pm.expect(d.user).to.deep.equal({name: "John"}))
          pm.test("property", () => pm.expect(d).to.have.property("user"))
          pm.test("include", () => pm.expect(d.tags).to.include("b"))
          pm.test("match", () => pm.expect(d.user.name).to.match(/^Jo/))
        `,
          sc,
          "post",
        );
        expect(outcome.tests.map((t) => t.passed)).toEqual([true, true, true, true]);
      });

      it("supports boolean terminal getters (to.be.true)", async () => {
        const result = makeResult({ status: 200 });
        const sc = createScriptContext(makeCtx(), makeRequest(), result);
        const ok = await executeScript(
          `
          pm.test("is true", () => pm.expect(true).to.be.true)
          pm.test("not false", () => pm.expect(true).to.not.be.false)
        `,
          sc,
          "post",
        );
        expect(ok.tests.map((t) => t.passed)).toEqual([true, true]);
        const bad = await executeScript(
          'pm.test("should fail", () => pm.expect(false).to.be.true)',
          sc,
          "post",
        );
        expect(bad.tests[0].passed).toBe(false);
      });

      it("supports pm.response.to.have.status/header/body", async () => {
        const result = makeResult({
          status: 201,
          responseHeaders: { "x-request-id": "abc" },
          body: '{"created":true}',
        });
        const sc = createScriptContext(makeCtx(), makeRequest(), result);
        const outcome = await executeScript(
          `
          pm.test("status", () => pm.response.to.have.status(201))
          pm.test("header", () => pm.response.to.have.header("X-Request-Id", "abc"))
          pm.test("body", () => pm.response.to.have.body("created"))
        `,
          sc,
          "post",
        );
        expect(outcome.tests.map((t) => t.passed)).toEqual([true, true, true]);
        const fail = await executeScript(
          'pm.test("bad", () => pm.response.to.have.status(200))',
          sc,
          "post",
        );
        expect(fail.tests[0].passed).toBe(false);
      });

      it("supports pm.response.to.be.ok / error", async () => {
        const result = makeResult({ status: 200 });
        const sc = createScriptContext(makeCtx(), makeRequest(), result);
        const ok = await executeScript('pm.test("ok", () => pm.response.to.be.ok)', sc, "post");
        expect(ok.tests[0].passed).toBe(true);
        const err = makeResult({ status: 500 });
        const sc2 = createScriptContext(makeCtx(), makeRequest(), err);
        const fail = await executeScript('pm.test("ok", () => pm.response.to.be.ok)', sc2, "post");
        expect(fail.tests[0].passed).toBe(false);
      });
    });

    describe("pm.environment / pm.variables / pm.cookies / pm.request", () => {
      it("reads and writes pm.environment and pm.variables", async () => {
        const ctx = makeCtx();
        ctx.vars.set("base", "api");
        const sc = createScriptContext(ctx, makeRequest());
        await executeScript(
          `
          pm.environment.set("TOKEN", "t1")
          pm.variables.set("X", "y")
        `,
          sc,
          "pre",
        );
        expect(ctx.envVars.get("TOKEN")).toBe("t1");
        expect(ctx.vars.get("X")).toBe("y");
      });

      it("pm.variables.replaceIn substitutes known and dynamic vars", async () => {
        const ctx = makeCtx();
        ctx.vars.set("id", "42");
        const sc = createScriptContext(ctx, makeRequest());
        const outcome = await executeScript(
          `
          const replaced = pm.variables.replaceIn("user/{{id}}/{{$randomInt}}")
          pm.test("replaceIn", () => pm.expect(replaced).to.match(/^user\\/42\\/\\d+$/))
        `,
          sc,
          "pre",
        );
        expect(outcome.tests[0].passed).toBe(true);
      });

      it("exposes response cookies via pm.cookies", async () => {
        const result = makeResult({ responseCookies: { session: "abc" } });
        const sc = createScriptContext(makeCtx(), makeRequest(), result);
        await executeScript(
          `
          pm.test("cookie", () => pm.expect(pm.cookies.get("session")).to.equal("abc"))
          pm.test("cookie missing", () => pm.expect(pm.cookies.get("nope")).to.be.undefined)
        `,
          sc,
          "post",
        );
      });

      it("pm.request exposes headers list", async () => {
        const sc = createScriptContext(makeCtx(), makeRequest());
        await executeScript(
          `
          pm.request.headers.upsert({ key: "X-Foo", value: "bar" })
          pm.test("header added", () => pm.expect(pm.request.headers.get("x-foo")).to.equal("bar"))
        `,
          sc,
          "pre",
        );
        expect(sc.request.headers["X-Foo"]).toBe("bar");
      });
    });

    describe("pm.sendRequest", () => {
      it("fetches through the injected fetchFn and reads the response", async () => {
        // Public IP literal so the SSRF guard short-circuits without DNS.
        const fetchFn = stubFetch(201, '{"id":7}');
        const sc = createScriptContext(makeCtx(), makeRequest());
        const outcome = await executeScript(
          `
          pm.test("send", async () => {
            const res = await pm.sendRequest("https://8.8.8.8/posts", { method: "POST" })
            pm.expect(res.code).to.equal(201)
            pm.expect(res.json().id).to.equal(7)
          })
        `,
          sc,
          "post",
          { fetchFn },
        );
        expect(outcome.tests[0].passed).toBe(true);
      });

      it("supports callback style", async () => {
        const fetchFn = stubFetch(200, "ok");
        const sc = createScriptContext(makeCtx(), makeRequest());
        const outcome = await executeScript(
          `
          pm.test("cb", () => new Promise((resolve, reject) => {
            pm.sendRequest("https://8.8.8.8/ping", (err, res) => {
              if (err) reject(err)
              else {
                try { pm.expect(res.code).to.equal(200); resolve() }
                catch (e) { reject(e) }
              }
            })
          }))
        `,
          sc,
          "post",
          { fetchFn },
        );
        expect(outcome.tests[0].passed).toBe(true);
      });

      it("blocks private/local URLs with the SSRF guard", async () => {
        const fetchFn = stubFetch(200);
        const sc = createScriptContext(makeCtx(), makeRequest());
        const outcome = await executeScript(
          `
          pm.test("blocked", async () => {
            await pm.sendRequest("http://127.0.0.1:7000/admin")
          })
        `,
          sc,
          "post",
          { fetchFn },
        );
        expect(outcome.tests[0].passed).toBe(false);
        expect(outcome.tests[0].error).toContain("blocked");
      });

      it("sends formdata bodies urlencoded (OAuth2 token dances)", async () => {
        let received: { body?: string; headers?: Record<string, string> } = {};
        const fetchFn = (async (_url: unknown, init?: RequestInit) => {
          received.body = String(init?.body);
          received.headers = init?.headers as Record<string, string>;
          return {
            status: 200,
            statusText: "OK",
            headers: { entries: () => [] as Array<[string, string]> },
            text: async () => '{"access_token":"tok"}',
          };
        }) as unknown as typeof fetch;
        const sc = createScriptContext(makeCtx(), makeRequest());
        const outcome = await executeScript(
          `
          pm.test("token", async () => {
            const res = await pm.sendRequest({
              method: "POST",
              url: "https://8.8.8.8/connect/token",
              body: {
                mode: "formdata",
                formdata: [
                  { key: "grant_type", value: "refresh_token" },
                  { key: "client_id", value: "cid" },
                ],
              },
            })
            pm.expect(res.json().access_token).to.equal("tok")
          })
        `,
          sc,
          "post",
          { fetchFn },
        );
        expect(outcome.tests[0].passed).toBe(true);
        expect(received.body).toBe("grant_type=refresh_token&client_id=cid");
        expect(received.headers?.["Content-Type"]).toBe("application/x-www-form-urlencoded");
      });

      it("awaits in-flight pm.sendRequest callbacks before the script resolves", async () => {
        // Regression: the Xero OAuth2 pre-request posts a token refresh via
        // pm.sendRequest(cb) without awaiting it, then the main request reads
        // {{access_token}}. The callback must have run before the script ends.
        const ctx = makeCtx();
        const fetchFn = (async () => {
          await new Promise((r) => setTimeout(r, 30));
          return {
            status: 200,
            statusText: "OK",
            headers: { entries: () => [] as Array<[string, string]> },
            text: async () => '{"access_token":"fresh-token"}',
          };
        }) as unknown as typeof fetch;
        const sc = createScriptContext(ctx, makeRequest());
        await executeScript(
          `
          pm.sendRequest("https://8.8.8.8/token", (err, res) => {
            pm.environment.set("access_token", res.json().access_token)
          })
        `,
          sc,
          "pre",
          { fetchFn },
        );
        expect(ctx.envVars.get("access_token")).toBe("fresh-token");
      });

      it("pm.variables.get resolves environment vars (Postman scope semantics)", async () => {
        const sc = createScriptContext(makeCtx(), makeRequest());
        const outcome = await executeScript(
          `
          tests["env var via pm.variables"] = pm.variables.get("API_KEY") === "secret123"
          tests["collectionVariables too"] = pm.collectionVariables.get("API_KEY") === "secret123"
        `,
          sc,
          "post",
          { fetchFn: stubFetch() },
        );
        expect(outcome.tests.every((t) => t.passed)).toBe(true);
      });
    });

    describe("legacy sandbox v1", () => {
      it("collects tests['name'] = boolean results", async () => {
        const result = makeResult({ status: 200 });
        const sc = createScriptContext(makeCtx(), makeRequest(), result);
        const outcome = await executeScript(
          `
          tests["status is 200"] = responseCode.code === 200
          tests["status is 404"] = responseCode.code === 404
        `,
          sc,
          "post",
        );
        expect(outcome.tests).toEqual([
          { name: "status is 200", passed: true },
          { name: "status is 404", passed: false, error: 'tests["status is 404"] was falsy' },
        ]);
      });

      it("supports postman.setEnvironmentVariable + responseBody (Xero-style legacy)", async () => {
        const ctx = makeCtx();
        const result = makeResult({
          status: 200,
          body: JSON.stringify([{ TenantId: "tenant-abc123" }]),
        });
        const sc = createScriptContext(ctx, makeRequest(), result);
        const outcome = await executeScript(
          `
          var data = JSON.parse(responseBody);
          postman.setEnvironmentVariable("xero-tenant-id", data[0].TenantId);
          tests["tenant: " + postman.getEnvironmentVariable("xero-tenant-id")] = true;
        `,
          sc,
          "post",
        );
        expect(ctx.envVars.get("xero-tenant-id")).toBe("tenant-abc123");
        expect(outcome.tests[0]).toEqual({ name: "tenant: tenant-abc123", passed: true });
      });

      it("exposes legacy responseHeaders / responseTime globals", async () => {
        const sc = createScriptContext(makeCtx(), makeRequest(), makeResult());
        const outcome = await executeScript(
          `
          tests["header"] = responseHeaders["content-type"] === "application/json"
          tests["time"] = responseTime > 0
        `,
          sc,
          "post",
        );
        expect(outcome.tests.every((t) => t.passed)).toBe(true);
      });

      it("postman.setNextRequest fails loudly (unsupported flow control)", async () => {
        const sc = createScriptContext(makeCtx(), makeRequest());
        await expect(executeScript('postman.setNextRequest("Next")', sc, "pre")).rejects.toThrow(
          /setNextRequest is not supported/,
        );
      });
    });

    describe("security sandbox", () => {
      it("does not allow require", async () => {
        const sc = createScriptContext(makeCtx(), makeRequest());
        await expect(executeScript('require("fs")', sc, "pre")).rejects.toThrow(ScriptError);
      });

      it("does not allow process access", async () => {
        const sc = createScriptContext(makeCtx(), makeRequest());
        await expect(executeScript("process.exit()", sc, "pre")).rejects.toThrow(ScriptError);
      });

      it("does not allow fetch", async () => {
        const sc = createScriptContext(makeCtx(), makeRequest());
        await expect(executeScript('fetch("http://evil.com")', sc, "pre")).rejects.toThrow(
          ScriptError,
        );
      });

      it("safe wrappers still allow JSON usage", async () => {
        const sc = createScriptContext(makeCtx(), makeRequest());
        await executeScript('vars.set("data", JSON.stringify({a:1}))', sc, "pre");
      });

      it("safe wrappers still allow Math usage", async () => {
        const sc = createScriptContext(makeCtx(), makeRequest());
        await executeScript('vars.set("val", String(Math.max(1, 2, 3)))', sc, "pre");
      });

      it("safe wrappers still allow Date.now()", async () => {
        const sc = createScriptContext(makeCtx(), makeRequest());
        await executeScript('vars.set("ts", String(Date.now()))', sc, "pre");
      });

      it("host-function constructor chains cannot reach the host realm (no RCE)", async () => {
        // Regression: `parseInt.constructor('return process')()` used to execute
        // in the HOST realm (the sandbox leaked the host Function constructor).
        const ctx = makeCtx();
        const sc = createScriptContext(ctx, makeRequest());
        const payloads = [
          'String(parseInt.constructor("return typeof process")() === "object")',
          'String(console.log.constructor("return typeof process")() === "object")',
          'String(env.get.constructor("return typeof process")() === "object")',
          'String(pm.variables.get.constructor("return typeof process")() === "object")',
          'String(JSON.parse.constructor("return typeof process")() === "object")',
          'String(Math.constructor.constructor("return typeof process")() === "object")',
        ];
        for (const p of payloads) {
          await executeScript(`vars.set("r", ${p})`, sc, "pre");
          expect(ctx.vars.get("r")).toBe("false");
        }
      });

      it("values returned into the sandbox are realm-safe (no .constructor ladder)", async () => {
        const ctx = makeCtx();
        const result = makeResult({ body: '{"token":"abc"}' });
        const sc = createScriptContext(ctx, makeRequest(), result);
        // Objects returned by host methods are proxied: .constructor is severed.
        const blocked = [
          'String(typeof response.json().constructor === "undefined")',
          'String(typeof response.headers.constructor === "undefined")',
        ];
        for (const p of blocked) {
          await executeScript(`vars.set("r", ${p})`, sc, "post");
          expect(ctx.vars.get("r")).toBe("true");
        }
        // Primitive values resolve to the SANDBOX realm's own constructors,
        // whose Function constructor still runs in the sandbox realm.
        await executeScript(
          'vars.set("r", String(response.json().token.constructor.constructor("return typeof process")() === "object"))',
          sc,
          "post",
        );
        expect(ctx.vars.get("r")).toBe("false");
      });

      it("blocks getter injection on host objects via defineProperty", async () => {
        // Regression: the Proxy used to forward defineProperty to the host
        // object, so a sandbox getter could later run with the HOST object as
        // `this` (re-exposing host constructors when the runner/reporter read
        // request.headers / responseHeaders).
        const ctx = makeCtx();
        const req = makeRequest({ headers: { "X-A": "1" } });
        const sc = createScriptContext(ctx, req);
        await executeScript(
          `
          try {
            Object.defineProperty(request.headers, "evil", {
              get() { pm.environment.set("pwned", String(this.constructor.constructor("return typeof process")())) }
            })
          } catch (e) {}
        `,
          sc,
          "pre",
        );
        expect(Object.getOwnPropertyDescriptor(req.headers, "evil")).toBeUndefined();
        expect(ctx.envVars.get("pwned")).toBeUndefined();
      });

      it("blocks constructor/__proto__ writes on host objects", async () => {
        const ctx = makeCtx();
        const req = makeRequest({ headers: { "X-A": "1" } });
        const sc = createScriptContext(ctx, req);
        await executeScript(
          `
          request.headers.__proto__ = { polluted: true }
          request.headers.constructor = {} /* intentional misuse */
        `,
          sc,
          "pre",
        );
        expect(Object.getPrototypeOf(req.headers)).toBe(Object.prototype);
        expect((req.headers as Record<string, unknown>).constructor).toBe(Object);
      });

      it("pm.sendRequest rejection errors are sandbox-realm", async () => {
        const ctx = makeCtx();
        const sc = createScriptContext(ctx, makeRequest());
        const outcome = await executeScript(
          `
          pm.test("leak check", async () => {
            try {
              await pm.sendRequest("http://127.0.0.1:7000/admin")
              throw new Error("should have been blocked")
            } catch (e) {
              // e is a sandbox Error — its constructor chain must not reach
              // the host realm (previously the host Error leaked here).
              pm.expect(e.constructor.constructor("return typeof process")() === "object").to.be.false
            }
          })
        `,
          sc,
          "pre",
          { fetchFn: stubFetch() },
        );
        expect(outcome.tests[0].passed).toBe(true);
      });
    });
  });
});

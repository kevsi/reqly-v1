import vm from "node:vm";
import type { RunnerContext, RequestItem, RunResult } from "./types.js";
import { interpolate } from "./chaining.js";
import { isUrlAllowed } from "./netguard.js";
import { resolveJsonPath } from "./path-utils.js";

interface EnvAPI {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  unset(key: string): void;
}

interface VarsAPI {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  unset(key: string): void;
}

interface RequestAPI {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  setHeader(key: string, value: string): void;
  setMethod(method: string): void;
  setUrl(url: string): void;
  setBody(body: string): void;
}

interface ResponseAPI {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  cookies: Record<string, string>;
  body?: string;
  durationMs: number;
  size: number;
  json(): unknown;
  text(): string;
  headersAsObject(): Record<string, string>;
}

interface ExpectResult {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toContain(expected: string): void;
  toBeGreaterThan(expected: number): void;
  toBeLessThan(expected: number): void;
  toMatch(regex: RegExp): void;
}

type ExpectFunction = (actual: unknown) => ExpectResult;

export interface ScriptContext {
  env: EnvAPI;
  vars: VarsAPI;
  request: RequestAPI;
  response?: ResponseAPI;
  /** Internal handle on the run context (cookie jar, vars) for the pm.* API. */
  __ctx?: RunnerContext;
}

/** One collected `pm.test(...)` / legacy `tests[...]` result. */
export interface PmTestResult {
  name: string;
  passed: boolean;
  error?: string;
}

/** What a script run leaves behind, beyond side effects on ctx/request. */
export interface ScriptOutcome {
  tests: PmTestResult[];
}

export interface ScriptOptions {
  timeoutMs?: number;
  /** Injectable for tests; defaults to globalThis.fetch. */
  fetchFn?: typeof fetch;
  /** Mirrors RunnerOptions.allowLocalHosts for pm.sendRequest. */
  allowLocalHosts?: boolean;
}

export class ScriptError extends Error {
  constructor(
    message: string,
    public scriptType: "pre" | "post",
    public scriptSource: string,
  ) {
    super(`[${scriptType} script] ${message}`);
    this.name = "ScriptError";
  }
}

export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssertionError";
  }
}

export function createScriptContext(
  ctx: RunnerContext,
  request: RequestItem,
  result?: RunResult,
): ScriptContext {
  const env: EnvAPI = {
    get: (key: string) => ctx.envVars.get(key),
    set: (key: string, value: string) => {
      ctx.envVars.set(key, value);
      ctx.vars.set(key, value);
    },
    unset: (key: string) => {
      ctx.envVars.delete(key);
      ctx.vars.delete(key);
    },
  };

  const vars: VarsAPI = {
    get: (key: string) => ctx.vars.get(key),
    set: (key: string, value: string) => ctx.vars.set(key, value),
    unset: (key: string) => ctx.vars.delete(key),
  };

  const reqHeaders = { ...(request.headers || {}) };
  const requestAPI: RequestAPI = {
    get method() {
      return request.method;
    },
    set method(v: string) {
      (request as any).method = v;
    },
    get url() {
      return request.url;
    },
    set url(v: string) {
      (request as any).url = v;
    },
    get headers() {
      return reqHeaders;
    },
    set headers(v) {
      Object.assign(reqHeaders, v);
    },
    get body() {
      return request.body;
    },
    set body(v) {
      (request as any).body = v;
    },
    setHeader(key: string, value: string) {
      reqHeaders[key] = value;
    },
    setMethod(m: string) {
      (request as any).method = m;
    },
    setUrl(u: string) {
      (request as any).url = u;
    },
    setBody(b: string) {
      (request as any).body = b;
    },
  };

  let responseAPI: ResponseAPI | undefined;

  if (result) {
    responseAPI = {
      status: result.status,
      statusText: result.statusText,
      headers: result.responseHeaders || {},
      cookies: result.responseCookies || {},
      durationMs: result.durationMs,
      size: result.size,
      get body() {
        return result.body;
      },
      json() {
        try {
          return JSON.parse(result.body || "null");
        } catch {
          throw new Error("Response body is not valid JSON");
        }
      },
      text() {
        return result.body || "";
      },
      headersAsObject() {
        return { ...(result.responseHeaders || {}) };
      },
    };
  }

  return { env, vars, request: requestAPI, response: responseAPI, __ctx: ctx };
}

// SECURITY: node:vm contexts are not sandboxes — values smuggled from the host
// realm expose the host `Function` constructor through `.constructor`
// (`parseInt.constructor('return process')()` runs in the HOST realm). This
// bridge runs INSIDE the context (sandbox realm) and rewraps every host value
// into sandbox-realm closures/proxies: host functions become closures whose
// results are re-wrapped and whose errors are re-thrown as sandbox errors, and
// host objects become live proxies whose reads are wrapped, whose writes
// forward to the host, and whose `.constructor`/`__proto__` access is severed.
// The bridge deletes the raw `__hostApi` handle once wrapped, so untrusted
// scripts can never reach a host-realm object or function.
const SANDBOX_BRIDGE = `
(function () {
  function bridgeError(e) {
    var msg = e && typeof e === 'object' && typeof e.message === 'string' ? e.message : String(e);
    var err = new Error(msg);
    if (e && typeof e === 'object' && typeof e.name === 'string' && e.name && e.name !== 'Error') {
      try { err.name = e.name; } catch (ignored) {}
    }
    return err;
  }

  function wrapValue(v) {
    if (v === null || v === undefined) return v;
    var t = typeof v;
    if (t !== 'object' && t !== 'function') return v; // primitives are realm-safe
    if (t === 'function') return wrapFn(v);
    if (typeof v.then === 'function') {
      // Promises cross as sandbox-realm promises resolving to wrapped values;
      // rejections are re-thrown as sandbox errors (never the host error).
      var p = Promise.resolve(v).then(
        function (r) { return wrapValue(r); },
        function (e) { throw bridgeError(e); },
      );
      // Callback-style pm.sendRequest returns a promise the user ignores; attach
      // a no-op handler so a failing request cannot crash the host process as an
      // unhandled rejection (users who await it still get the rejection).
      p.catch(function () {});
      return p;
    }
    if (Array.isArray(v)) {
      var arr = [];
      for (var i = 0; i < v.length; i++) arr.push(wrapValue(v[i]));
      return arr;
    }
    return wrapObject(v);
  }

  function wrapFn(v) {
    return function () {
      var args = Array.prototype.slice.call(arguments).map(function (a) {
        // Callbacks handed to the host are later invoked with HOST values;
        // wrap them so those values are sanitized before user code sees them.
        return typeof a === 'function' ? wrapArgForHost(a) : a;
      });
      try {
        // Host methods are invoked with this = null: every host API method
        // closes over its state and must never rely on this.
        return wrapValue(v.apply(null, args));
      } catch (e) {
        throw bridgeError(e);
      }
    };
  }

  function wrapArgForHost(a) {
    return function () {
      var args = Array.prototype.map.call(arguments, function (x) { return wrapValue(x); });
      return a.apply(null, args);
    };
  }

  function wrapObject(v) {
    return new Proxy(v, {
      get: function (t, key) {
        if (key === 'constructor' || key === '__proto__') return undefined;
        var desc;
        try { desc = Object.getOwnPropertyDescriptor(t, key); } catch (e) { desc = null; }
        if (desc && desc.get) {
          try { return wrapValue(desc.get.call(t)); } catch (e) { throw bridgeError(e); }
        }
        var raw;
        try { raw = t[key]; } catch (e) { return undefined; }
        return wrapValue(raw);
      },
      set: function (t, key, val) {
        if (key === 'constructor' || key === '__proto__') return false;
        try { t[key] = val; } catch (e) { return false; }
        return true;
      },
      has: function (t, key) {
        if (key === 'constructor' || key === '__proto__') return false;
        return key in t;
      },
      ownKeys: function (t) {
        var names = Object.getOwnPropertyNames(t);
        var out = [];
        for (var i = 0; i < names.length; i++) out.push(names[i]);
        return out;
      },
      getOwnPropertyDescriptor: function (t, key) {
        if (key === 'constructor' || key === '__proto__') return undefined;
        var d = Object.getOwnPropertyDescriptor(t, key);
        if (!d) return undefined;
        var out = {};
        if ('value' in d) { out.value = wrapValue(d.value); out.writable = d.writable; }
        if (d.get) {
          out.get = function () {
            try { return wrapValue(d.get.call(t)); } catch (e) { throw bridgeError(e); }
          };
        }
        if (d.set) {
          out.set = function (val) {
            try { d.set.call(t, val); } catch (e) { throw bridgeError(e); }
          };
        }
        out.enumerable = d.enumerable;
        out.configurable = d.configurable;
        return out;
      },
      deleteProperty: function (t, key) {
        if (key === 'constructor' || key === '__proto__') return false;
        try { delete t[key]; return true; } catch (e) { return false; }
      },
      // Sandbox-defined getters/setters on a host object would later run with
      // the HOST object as this (re-exposing host constructors): reject them.
      defineProperty: function (t, key, desc) {
        if (key === 'constructor' || key === '__proto__') return false;
        if (desc && (typeof desc.get === 'function' || typeof desc.set === 'function')) {
          return false;
        }
        try { Object.defineProperty(t, key, desc); return true; } catch (e) { return false; }
      },
      getPrototypeOf: function () { return null; },
      setPrototypeOf: function () { return false; },
      isExtensible: function () { return true; },
      preventExtensions: function () { return false; },
    });
  }

  var api = this.__hostApi;
  for (var k in api) {
    if (Object.prototype.hasOwnProperty.call(api, k)) {
      try { this[k] = wrapValue(api[k]); } catch (e) { /* keep going */ }
    }
  }
  delete this.__hostApi;
}).call(this);
`;

export async function executeScript(
  scriptSource: string,
  scriptContext: ScriptContext,
  scriptType: "pre" | "post",
  options: ScriptOptions = {},
): Promise<ScriptOutcome> {
  if (!scriptSource || !scriptSource.trim()) return { tests: [] };

  const timeoutMs = options.timeoutMs ?? 5000;
  const fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
  const allowLocalHosts = options.allowLocalHosts;
  const ctx = scriptContext.__ctx;

  const sandbox = vm.createContext(Object.create(null));

  // Explicitly shadow dangerous globals so they're undefined in the sandbox
  // realm. Plain `undefined` assignments — primitives, so realm-safe.
  sandbox.setTimeout = undefined;
  sandbox.setInterval = undefined;
  sandbox.clearTimeout = undefined;
  sandbox.clearInterval = undefined;
  sandbox.require = undefined;
  sandbox.process = undefined;
  sandbox.global = undefined;
  sandbox.globalThis = undefined;
  sandbox.fetch = undefined;

  // ── Postman sandbox API ──────────────────────────────────────────────────
  const testResults: PmTestResult[] = [];
  const pendingTests: Promise<PmTestResult>[] = [];
  const pendingRequests: Promise<unknown>[] = [];

  // Legacy sandbox v1: tests["name"] = boolean / responseCode.code
  const tests: Record<string, unknown> = Object.create(null);

  // Every value the scripts may touch goes into hostApi — NOT directly onto the
  // sandbox. SANDBOX_BRIDGE below rewraps each entry into a sandbox-realm
  // closure/proxy and removes __hostApi, so no host-realm object or function
  // (whose .constructor would expose the host `Function` constructor) is ever
  // reachable by the untrusted script.
  const hostApi: Record<string, unknown> = {
    env: scriptContext.env,
    environment: scriptContext.env, // legacy sandbox v1
    globals: scriptContext.env, // legacy sandbox v1
    vars: scriptContext.vars,
    request: scriptContext.request,
    console: createSandboxConsole(),
    expect: createExpectFunction(),
    tests,
    pm: buildPmApi(
      scriptContext,
      testResults,
      pendingTests,
      pendingRequests,
      fetchFn,
      timeoutMs,
      allowLocalHosts,
    ),
    // Legacy `postman.*` helpers (sandbox v1). setNextRequest is Postman flow
    // control we do not support — fail loudly instead of silently diverging.
    postman: {
      // Real collections pass `undefined` values (e.g. a missing JSON field) —
      // coerce so the var never stores an undefined and stays interpolable.
      setEnvironmentVariable: (k: string, v?: string) => scriptContext.env.set(k, v ?? ""),
      getEnvironmentVariable: (k: string) => scriptContext.env.get(k),
      clearEnvironmentVariable: (k: string) => scriptContext.env.unset(k),
      setGlobalVariable: (k: string, v?: string) => scriptContext.env.set(k, v ?? ""),
      getGlobalVariable: (k: string) => scriptContext.env.get(k),
      clearGlobalVariable: (k: string) => scriptContext.env.unset(k),
      setNextRequest: () => {
        throw new Error("postman.setNextRequest is not supported by recli");
      },
      setNextRequestName: () => {
        throw new Error("postman.setNextRequestName is not supported by recli");
      },
    },
    responseCode: scriptContext.response
      ? {
          get code() {
            return scriptContext.response!.status;
          },
          get name() {
            return scriptContext.response!.statusText;
          },
        }
      : {
          get code() {
            return 0;
          },
          get name() {
            return "N/A";
          },
        },
    // Appended await drains pm.test() callbacks (incl. awaited pm.sendRequest)
    // before the script resolves, so results are complete when we read them.
    // In-flight pm.sendRequest() calls are awaited too — Postman waits for them
    // before proceeding, and their callbacks may set env vars the main request
    // interpolates (the OAuth2 token dance is the canonical case). Rejections
    // are surfaced (not silently eaten): the callback form already received the
    // error, and awaited-in-test failures are recorded by the test itself — a
    // callback-less fire-and-forget failure gets a warning so a broken token
    // fetch cannot pass unnoticed.
    __recliFlushTests: async (): Promise<void> => {
      for (;;) {
        const batch = pendingTests.splice(0, pendingTests.length);
        const reqBatch = pendingRequests.splice(0, pendingRequests.length);
        if (batch.length === 0 && reqBatch.length === 0) return;
        if (reqBatch.length) {
          await Promise.all(
            reqBatch.map((p) =>
              p.catch((e: unknown) => {
                console.warn(
                  `[script] pm.sendRequest failed: ${e instanceof Error ? e.message : String(e)}`,
                );
              }),
            ),
          );
        }
        // Collect results in registration order — a sync throw in one pm.test
        // must not reorder it ahead of an earlier still-awaiting test.
        const results = await Promise.all(batch);
        for (const r of results) testResults.push(r);
      }
    },
  };

  if (scriptType === "post" && scriptContext.response) {
    hostApi.response = scriptContext.response;
    // Legacy Postman sandbox v1 globals — used by pre-2.x collections and many
    // real-world exports (e.g. Xero 2019) alongside tests[]/responseCode.
    hostApi.responseBody = scriptContext.response.body ?? "";
    hostApi.responseHeaders = scriptContext.response.headers;
    hostApi.responseTime = scriptContext.response.durationMs;
  }

  // SECURITY: node:vm is not a sandbox by itself. Any host-realm function or
  // object handed to the context leaks the host `Function` constructor through
  // `.constructor` — `parseInt.constructor('return process')()` executes in the
  // HOST realm (this was an RCE: a downloaded collection could read the user's
  // files/process). So nothing host-side is injected directly: all host values
  // sit under __hostApi, and SANDBOX_BRIDGE (running INSIDE the context, i.e.
  // the sandbox realm) rewraps each one into sandbox-realm closures/proxies
  // then deletes __hostApi. The context's own built-ins (Object, Function,
  // JSON, Math, Date, …) live in the sandbox realm and are safe to use.
  sandbox.__hostApi = hostApi;
  vm.runInContext(SANDBOX_BRIDGE, sandbox);
  delete sandbox.__hostApi;

  // try/finally guarantees the flush runs even if the user script returns early
  // (a bare `return` would otherwise skip the appended drain line).
  const wrappedScript = `(async function() {\ntry {\n${scriptSource}\n} finally {\nawait __recliFlushTests();\n}\n})()`;

  let promise: Promise<unknown>;
  try {
    const script = new vm.Script(wrappedScript, { filename: `recli-${scriptType}.js` });
    promise = script.runInContext(sandbox, { timeout: timeoutMs }) as Promise<unknown>;
  } catch (e) {
    throw wrapError(e, scriptType, scriptSource);
  }

  // Bound the async part (pm.sendRequest, await, pm.test bodies). The timer is
  // cleared on settle so it does not keep the event loop alive.
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Script timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    promise.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  }).catch((e: unknown) => {
    throw wrapError(e, scriptType, scriptSource);
  });

  // Convert legacy `tests["name"] = bool` into collected results.
  for (const [name, val] of Object.entries(tests)) {
    if (val) testResults.push({ name, passed: true });
    else testResults.push({ name, passed: false, error: `tests["${name}"] was falsy` });
  }

  return { tests: testResults };
}

/** Message of an error that may originate in the sandbox realm (cross-realm
 * `instanceof Error` is false) — duck-type `.message` instead. */
function messageOf(e: unknown): string {
  return e && typeof e === "object" && typeof (e as { message?: unknown }).message === "string"
    ? (e as { message: string }).message
    : String(e);
}

function wrapError(e: unknown, scriptType: "pre" | "post", scriptSource: string): ScriptError {
  const isAssertion =
    e instanceof AssertionError ||
    (e !== null && typeof e === "object" && (e as { name?: unknown }).name === "AssertionError");
  if (isAssertion) {
    return new ScriptError(`Assertion failed: ${messageOf(e)}`, scriptType, scriptSource);
  }
  return new ScriptError(messageOf(e), scriptType, scriptSource);
}

function createSandboxConsole() {
  return {
    log: (...args: unknown[]) => console.log(`[script]`, ...args),
    warn: (...args: unknown[]) => console.warn(`[script]`, ...args),
    error: (...args: unknown[]) => console.error(`[script]`, ...args),
    info: (...args: unknown[]) => console.info(`[script]`, ...args),
  };
}

// Sort object keys recursively for stable deep comparison
function sortKeys(o: unknown): unknown {
  if (o === null || o === undefined) return o;
  if (Array.isArray(o)) return o.map(sortKeys);
  if (typeof o === "object") {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(o as Record<string, unknown>).sort()) {
      sorted[k] = sortKeys((o as Record<string, unknown>)[k]);
    }
    return sorted;
  }
  return o;
}

function createExpectFunction(): ExpectFunction {
  return function expect(actual: unknown): ExpectResult {
    return {
      toBe(expected: unknown) {
        if (actual !== expected) {
          throw new AssertionError(
            `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
          );
        }
      },
      toEqual(expected: unknown) {
        const a = JSON.stringify(sortKeys(actual));
        const b = JSON.stringify(sortKeys(expected));
        if (a !== b) {
          throw new AssertionError(`expected ${b}, got ${a}`);
        }
      },
      toContain(expected: string) {
        const str = String(actual);
        if (!str.includes(expected)) {
          throw new AssertionError(`expected "${str}" to contain "${expected}"`);
        }
      },
      toBeGreaterThan(expected: number) {
        if (typeof actual !== "number" || actual <= expected) {
          throw new AssertionError(`expected ${actual} to be greater than ${expected}`);
        }
      },
      toBeLessThan(expected: number) {
        if (typeof actual !== "number" || actual >= expected) {
          throw new AssertionError(`expected ${actual} to be less than ${expected}`);
        }
      },
      toMatch(regex: RegExp) {
        if (!regex.test(String(actual))) {
          throw new AssertionError(`expected "${actual}" to match ${regex}`);
        }
      },
    };
  };
}

// ── Chai-lite (`pm.expect`) ────────────────────────────────────────────────

interface ChaiLite {
  to: ChaiLite;
  be: ChaiLite;
  been: ChaiLite;
  is: ChaiLite;
  that: ChaiLite;
  which: ChaiLite;
  and: ChaiLite;
  has: ChaiLite;
  have: ChaiLite;
  with: ChaiLite;
  not: ChaiLite;
  deep: ChaiLite;
  true: ChaiLite;
  false: ChaiLite;
  null: ChaiLite;
  undefined: ChaiLite;
  ok: ChaiLite;
  empty: ChaiLite;
  equal(expected: unknown): void;
  equals(expected: unknown): void;
  eql(expected: unknown): void;
  property(key: string, value?: unknown): ChaiLite;
  include(expected: unknown): void;
  includes(expected: unknown): void;
  contain(expected: unknown): void;
  contains(expected: unknown): void;
  match(regex: RegExp): void;
  above(n: number): void;
  greaterThan(n: number): void;
  below(n: number): void;
  lessThan(n: number): void;
  least(n: number): void;
  most(n: number): void;
  lengthOf(n: number): void;
  length(n: number): void;
  a(type: string): void;
  an(type: string): void;
  oneOf(values: unknown[]): void;
}

function chaiAssert(actual: unknown, negate: boolean, deep: boolean): ChaiLite {
  const fail = (msg: string): void => {
    if (!negate) throw new AssertionError(msg);
  };
  const pass = (msg: string): void => {
    if (negate) throw new AssertionError(msg);
  };
  const deepEq = (expected: unknown): boolean =>
    JSON.stringify(sortKeys(actual)) === JSON.stringify(sortKeys(expected));

  const chain: Partial<ChaiLite> & {
    equal: (e: unknown) => void;
    equals: (e: unknown) => void;
    eql: (e: unknown) => void;
    property: (k: string, v?: unknown) => ChaiLite;
    include: (e: unknown) => void;
    includes: (e: unknown) => void;
    contain: (e: unknown) => void;
    contains: (e: unknown) => void;
    match: (r: RegExp) => void;
    above: (n: number) => void;
    greaterThan: (n: number) => void;
    below: (n: number) => void;
    lessThan: (n: number) => void;
    least: (n: number) => void;
    most: (n: number) => void;
    lengthOf: (n: number) => void;
    a: (t: string) => void;
    an: (t: string) => void;
    oneOf: (v: unknown[]) => void;
  } = {
    to: null as unknown as ChaiLite,
    be: null as unknown as ChaiLite,
    been: null as unknown as ChaiLite,
    is: null as unknown as ChaiLite,
    that: null as unknown as ChaiLite,
    which: null as unknown as ChaiLite,
    and: null as unknown as ChaiLite,
    has: null as unknown as ChaiLite,
    have: null as unknown as ChaiLite,
    with: null as unknown as ChaiLite,
    not: null as unknown as ChaiLite,
    deep: null as unknown as ChaiLite,
    equal(expected: unknown) {
      if (deep ? !deepEq(expected) : actual !== expected) {
        fail(`expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
      } else {
        pass(`expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
      }
    },
    equals(expected: unknown) {
      if (deep ? !deepEq(expected) : actual !== expected) {
        fail(`expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
      } else {
        pass(`expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
      }
    },
    eql(expected: unknown) {
      if (!deepEq(expected))
        fail(`expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
      else pass(`expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
    },
    property(key: string, value?: unknown) {
      const has = actual !== null && typeof actual === "object" && key in (actual as object);
      const prop = (actual as Record<string, unknown> | null | undefined)?.[key];
      if (!has) fail(`expected object to have property "${key}"`);
      if (value !== undefined && prop !== value) {
        fail(
          `expected property "${key}" to equal ${JSON.stringify(value)} but got ${JSON.stringify(prop)}`,
        );
      }
      return chaiAssert(prop, negate, deep);
    },
    include(expected: unknown) {
      assertContain(actual, expected, negate);
    },
    includes(expected: unknown) {
      assertContain(actual, expected, negate);
    },
    contain(expected: unknown) {
      assertContain(actual, expected, negate);
    },
    contains(expected: unknown) {
      assertContain(actual, expected, negate);
    },
    match(regex: RegExp) {
      if (!regex.test(String(actual))) fail(`expected "${String(actual)}" to match ${regex}`);
      else pass(`expected "${String(actual)}" to match ${regex}`);
    },
    above(n: number) {
      if (typeof actual !== "number" || actual <= n) fail(`expected ${actual} to be above ${n}`);
      else pass(`expected ${actual} to be above ${n}`);
    },
    greaterThan(n: number) {
      if (typeof actual !== "number" || actual <= n)
        fail(`expected ${actual} to be greater than ${n}`);
      else pass(`expected ${actual} to be greater than ${n}`);
    },
    below(n: number) {
      if (typeof actual !== "number" || actual >= n) fail(`expected ${actual} to be below ${n}`);
      else pass(`expected ${actual} to be below ${n}`);
    },
    lessThan(n: number) {
      if (typeof actual !== "number" || actual >= n)
        fail(`expected ${actual} to be less than ${n}`);
      else pass(`expected ${actual} to be less than ${n}`);
    },
    least(n: number) {
      if (typeof actual !== "number" || actual < n) fail(`expected ${actual} to be at least ${n}`);
      else pass(`expected ${actual} to be at least ${n}`);
    },
    most(n: number) {
      if (typeof actual !== "number" || actual > n) fail(`expected ${actual} to be at most ${n}`);
      else pass(`expected ${actual} to be at most ${n}`);
    },
    lengthOf(n: number) {
      const len = (actual as { length?: number } | null | undefined)?.length ?? 0;
      if (len !== n) fail(`expected length ${n} but got ${len}`);
      else pass(`expected length ${n} but got ${len}`);
    },
    length(n: number) {
      const len = (actual as { length?: number } | null | undefined)?.length ?? 0;
      if (len !== n) fail(`expected length ${n} but got ${len}`);
      else pass(`expected length ${n} but got ${len}`);
    },
    a(type: string) {
      if (chaiTypeOf(actual) !== type) {
        fail(`expected ${JSON.stringify(actual)} to be a ${type} but got ${chaiTypeOf(actual)}`);
      } else {
        pass(`expected ${JSON.stringify(actual)} to be a ${type}`);
      }
    },
    an(type: string) {
      if (chaiTypeOf(actual) !== type) {
        fail(`expected ${JSON.stringify(actual)} to be an ${type} but got ${chaiTypeOf(actual)}`);
      } else {
        pass(`expected ${JSON.stringify(actual)} to be an ${type}`);
      }
    },
    oneOf(values: unknown[]) {
      if (!values.some((v) => deepEq(v)))
        fail(`expected ${JSON.stringify(actual)} to be one of ${JSON.stringify(values)}`);
      else pass(`expected ${JSON.stringify(actual)} to be one of ${JSON.stringify(values)}`);
    },
  };

  // Chai chain keywords that don't change state return the same object
  // (lazily — eager construction of fresh assertions here recursed to stack
  // overflow). Only `not`/`deep` spawn a new assertion with flipped flags.
  const keywords = ["to", "be", "been", "is", "that", "which", "and", "has", "have", "with"];
  for (const kw of keywords) {
    Object.defineProperty(chain, kw, {
      enumerable: true,
      configurable: true,
      get: () => chain as ChaiLite,
    });
  }
  Object.defineProperty(chain, "not", {
    enumerable: true,
    configurable: true,
    get: () => chaiAssert(actual, !negate, deep),
  });
  Object.defineProperty(chain, "deep", {
    enumerable: true,
    configurable: true,
    get: () => chaiAssert(actual, negate, true),
  });

  // Terminal flags (`pm.expect(x).to.be.true`) assert on property access.
  const terminals: Record<string, () => boolean> = {
    true: () => actual === true,
    false: () => actual === false,
    null: () => actual === null,
    undefined: () => actual === undefined,
    ok: () => Boolean(actual),
    empty: () => !(actual as { length?: number } | null | undefined)?.length,
  };
  for (const [prop, check] of Object.entries(terminals)) {
    Object.defineProperty(chain, prop, {
      enumerable: true,
      configurable: true,
      get() {
        const ok = check();
        if (negate ? ok : !ok) {
          throw new AssertionError(
            `expected ${negate ? "not " : ""}${prop} but got ${JSON.stringify(actual)}`,
          );
        }
        return chain as ChaiLite;
      },
    });
  }

  return chain as ChaiLite;
}

/** Chai-style type name: 'array', 'date', 'regexp', 'null', 'string', … */
function chaiTypeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (value instanceof Date) return "date";
  if (value instanceof RegExp) return "regexp";
  if (value instanceof Map) return "map";
  if (value instanceof Set) return "set";
  if (value instanceof ArrayBuffer) return "arraybuffer";
  if (typeof value === "object" && typeof (value as { then?: unknown })?.then === "function")
    return "promise";
  return typeof value;
}

function assertContain(actual: unknown, expected: unknown, negate: boolean): void {
  const fail = (msg: string): void => {
    if (!negate) throw new AssertionError(msg);
  };
  const pass = (msg: string): void => {
    if (negate) throw new AssertionError(msg);
  };
  if (typeof actual === "string") {
    if (!actual.includes(String(expected))) fail(`expected "${actual}" to include "${expected}"`);
    else pass(`expected "${actual}" to include "${expected}"`);
  } else if (Array.isArray(actual)) {
    const hit = actual.some(
      (x) => JSON.stringify(sortKeys(x)) === JSON.stringify(sortKeys(expected)),
    );
    if (!hit) fail(`expected array to include ${JSON.stringify(expected)}`);
    else pass(`expected array to include ${JSON.stringify(expected)}`);
  } else if (actual !== null && typeof actual === "object") {
    if (!(String(expected) in (actual as object)))
      fail(`expected object to have property "${expected}"`);
    else pass(`expected object to have property "${expected}"`);
  } else {
    fail(`cannot .include on ${typeof actual}`);
  }
}

// ── pm.* API ───────────────────────────────────────────────────────────────

function buildPmApi(
  scriptContext: ScriptContext,
  testResults: PmTestResult[],
  pendingTests: Promise<PmTestResult>[],
  pendingRequests: Promise<unknown>[],
  fetchFn: typeof fetch,
  timeoutMs: number,
  allowLocalHosts: boolean | undefined,
): Record<string, unknown> {
  const ctx = scriptContext.__ctx;
  const response = scriptContext.response;

  // pm.variables / pm.collectionVariables resolve across scopes (Postman
  // semantics): local vars first, then environment, then process.env.
  const scopeGet = (k: string): string | undefined => {
    const v = scriptContext.vars.get(k);
    if (v !== undefined) return v;
    const e = scriptContext.env.get(k);
    if (e !== undefined) return e;
    return process.env[k];
  };

  const headerList = (record: Record<string, string>) => ({
    get: (key: string) => {
      const hit = Object.entries(record).find(([k]) => k.toLowerCase() === key.toLowerCase());
      return hit ? hit[1] : undefined;
    },
    has: (key: string) => Object.keys(record).some((k) => k.toLowerCase() === key.toLowerCase()),
    add: (h: { key: string; value: string }) => {
      record[h.key] = h.value;
    },
    upsert: (h: { key: string; value: string }) => {
      record[h.key] = h.value;
    },
    remove: (key: string) => {
      for (const k of Object.keys(record))
        if (k.toLowerCase() === key.toLowerCase()) delete record[k];
    },
    all: () => Object.entries(record).map(([key, value]) => ({ key, value })),
    count: () => Object.keys(record).length,
    toObject: () => ({ ...record }),
  });

  const pmRequest = {
    get method() {
      return scriptContext.request.method;
    },
    set method(v: string) {
      scriptContext.request.setMethod(v);
    },
    get url() {
      return scriptContext.request.url;
    },
    set url(v: string) {
      scriptContext.request.setUrl(v);
    },
    get body(): string | undefined {
      return scriptContext.request.body;
    },
    set body(v: string) {
      scriptContext.request.setBody(v);
    },
    headers: headerList(scriptContext.request.headers),
  };

  const responseAssertions = (r: ResponseAPI) => ({
    have: {
      status: (expected: number | RegExp) => {
        const ok =
          typeof expected === "number" ? r.status === expected : expected.test(String(r.status));
        if (!ok)
          throw new AssertionError(
            `expected response status ${String(expected)} but got ${r.status}`,
          );
      },
      statusCode: (expected: number | RegExp) => {
        const ok =
          typeof expected === "number" ? r.status === expected : expected.test(String(r.status));
        if (!ok)
          throw new AssertionError(
            `expected response status ${String(expected)} but got ${r.status}`,
          );
      },
      header: (key: string, value?: string) => {
        const hit = Object.entries(r.headers).find(([k]) => k.toLowerCase() === key.toLowerCase());
        if (!hit)
          throw new AssertionError(`expected response header "${key}" but it was not present`);
        if (value !== undefined && hit[1] !== value) {
          throw new AssertionError(
            `expected response header "${key}" to equal ${JSON.stringify(value)} but got ${JSON.stringify(hit[1])}`,
          );
        }
      },
      body: (expected: string | RegExp) => {
        const body = r.body || "";
        const ok = typeof expected === "string" ? body.includes(expected) : expected.test(body);
        if (!ok) throw new AssertionError(`expected response body to contain ${String(expected)}`);
      },
      jsonBody: (path?: string) => {
        let data: unknown;
        try {
          data = r.json();
        } catch {
          throw new AssertionError("expected a JSON response body");
        }
        if (path) {
          const value = resolveJsonPath(data, path);
          if (value === undefined)
            throw new AssertionError(`expected JSON body path "${path}" to exist`);
        }
      },
      // ponytail: jsonSchema() would need a JSON-Schema validator (ajv); skipped —
      // recli's own structured `assert` supports JSON Schema assertions instead.
    },
    be: {
      get ok(): boolean {
        if (!(r.status >= 200 && r.status < 300))
          throw new AssertionError(`expected a 2xx status but got ${r.status}`);
        return true;
      },
      get success(): boolean {
        if (!(r.status >= 200 && r.status < 300))
          throw new AssertionError(`expected a 2xx status but got ${r.status}`);
        return true;
      },
      get error(): boolean {
        if (!(r.status >= 400))
          throw new AssertionError(`expected an error status but got ${r.status}`);
        return true;
      },
      get clientError(): boolean {
        if (!(r.status >= 400 && r.status < 500))
          throw new AssertionError(`expected a 4xx status but got ${r.status}`);
        return true;
      },
      get serverError(): boolean {
        if (!(r.status >= 500))
          throw new AssertionError(`expected a 5xx status but got ${r.status}`);
        return true;
      },
      get redirection(): boolean {
        if (!(r.status >= 300 && r.status < 400))
          throw new AssertionError(`expected a 3xx status but got ${r.status}`);
        return true;
      },
    },
  });

  const pmResponse = response
    ? {
        code: response.status,
        status: response.statusText,
        responseTime: response.durationMs,
        responseSize: response.size,
        headers: Object.entries(response.headers).map(([key, value]) => ({ key, value })),
        body: response.body,
        text: () => response!.text(),
        json: () => response!.json(),
        headersAsObject: () => response!.headersAsObject(),
        to: responseAssertions(response),
      }
    : undefined;

  const replaceIn = (text: string): string => (ctx ? interpolate(text, ctx, new Map()) : text);

  const cookieSource = (): Record<string, string> => {
    if (response) return { ...response.cookies };
    if (ctx) return Object.fromEntries(ctx.cookies);
    return {};
  };

  const pmCookies = {
    get: (name: string) => cookieSource()[name] ?? undefined,
    has: (name: string) => name in cookieSource(),
    toObject: () => cookieSource(),
  };

  const sendRequest = (
    urlOrObj: string | Record<string, unknown>,
    optionsOrCb?: Record<string, unknown> | ((err: unknown, res?: unknown) => void),
    maybeCb?: (err: unknown, res?: unknown) => void,
  ): Promise<unknown> => {
    let url: string;
    let options: Record<string, unknown> = {};
    let callback: ((err: unknown, res?: unknown) => void) | undefined;

    if (urlOrObj && typeof urlOrObj === "object") {
      url = String(
        (urlOrObj as Record<string, unknown>).url ??
          (urlOrObj as Record<string, unknown>).raw ??
          "",
      );
      options = { ...urlOrObj };
    } else {
      url = String(urlOrObj);
    }
    if (typeof optionsOrCb === "function") callback = optionsOrCb;
    else if (optionsOrCb) {
      options = { ...options, ...optionsOrCb };
      if (typeof maybeCb === "function") callback = maybeCb;
    }

    const promise = (async () => {
      const target = replaceIn(url);
      const check = await isUrlAllowed(target, allowLocalHosts);
      if (!check.allowed) throw new Error(`pm.sendRequest blocked: ${check.reason}`);

      const method = String(options.method ?? "GET").toUpperCase();
      const rawHeaders =
        (options.header as Array<{ key: string; value: string }> | undefined) ??
        (options.headers as Record<string, string> | undefined);
      const headers: Record<string, string> = {};
      if (Array.isArray(rawHeaders)) {
        for (const h of rawHeaders) headers[h.key] = h.value;
      } else if (rawHeaders && typeof rawHeaders === "object") {
        Object.assign(headers, rawHeaders);
      }
      const bodyOpt = options.body as unknown;
      let body: string | undefined;
      if (typeof bodyOpt === "string") body = bodyOpt;
      else if (bodyOpt && typeof bodyOpt === "object") {
        const rec = bodyOpt as Record<string, unknown>;
        if ("raw" in rec && typeof rec.raw === "string") body = rec.raw;
        // Postman formdata/urlencoded bodies (used by OAuth2 token dances):
        // urlencode the entries and set the form content type.
        const mode = typeof rec.mode === "string" ? rec.mode : undefined;
        if (mode === "formdata" || mode === "urlencoded") {
          const entries = Array.isArray(rec[mode])
            ? (rec[mode] as Array<Record<string, unknown>>)
            : [];
          const parts: string[] = [];
          for (const entry of entries) {
            if (entry.key === undefined) continue;
            const val = entry.value === undefined ? "" : String(entry.value);
            parts.push(`${encodeURIComponent(String(entry.key))}=${encodeURIComponent(val)}`);
          }
          if (parts.length) body = parts.join("&");
          if (!Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) {
            headers["Content-Type"] = "application/x-www-form-urlencoded";
          }
        }
      }

      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetchFn(target, { method, headers, body, signal: controller.signal });
        const text = await res.text();
        const hdrs = Array.from(res.headers.entries()).map(([key, value]) => ({ key, value }));
        return {
          code: res.status,
          status: res.statusText,
          headers: hdrs,
          body: text,
          text: () => text,
          json: () => {
            try {
              return JSON.parse(text);
            } catch {
              throw new Error("Response body is not valid JSON");
            }
          },
          toObject: () => ({ code: res.status, status: res.statusText, headers: hdrs, body: text }),
        };
      } finally {
        clearTimeout(t);
      }
    })();

    pendingRequests.push(promise);
    if (callback) {
      promise.then(
        (r) => callback(null, r),
        (e) => callback(e),
      );
    }
    return promise;
  };

  return {
    test: (name: string, fn: () => unknown | Promise<unknown>) => {
      pendingTests.push(
        (async (): Promise<PmTestResult> => {
          try {
            await fn();
            return { name, passed: true };
          } catch (e) {
            return { name, passed: false, error: messageOf(e) };
          }
        })(),
      );
    },
    expect: (actual: unknown): ChaiLite => chaiAssert(actual, false, false),
    response: pmResponse,
    request: pmRequest,
    environment: {
      get: (k: string) => scriptContext.env.get(k),
      set: (k: string, v: string) => scriptContext.env.set(k, v),
      unset: (k: string) => scriptContext.env.unset(k),
    },
    variables: {
      get: scopeGet,
      set: (k: string, v: string) => scriptContext.vars.set(k, v),
      unset: (k: string) => scriptContext.vars.unset(k),
      replaceIn,
    },
    collectionVariables: {
      get: scopeGet,
      set: (k: string, v: string) => scriptContext.vars.set(k, v),
      unset: (k: string) => scriptContext.vars.unset(k),
    },
    globals: {
      get: (k: string) => scriptContext.env.get(k),
      set: (k: string, v: string) => scriptContext.env.set(k, v),
      unset: (k: string) => scriptContext.env.unset(k),
    },
    cookies: pmCookies,
    sendRequest,
  };
}

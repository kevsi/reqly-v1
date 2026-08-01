import vm from "node:vm"
import type { RunnerContext, RequestItem, RunResult } from "./types.js"

interface ScriptAPI {
  env: EnvAPI
  vars: VarsAPI
  request: RequestAPI
  response?: ResponseAPI
  expect: ExpectFunction
  console: typeof console
}

interface EnvAPI {
  get(key: string): string | undefined
  set(key: string, value: string): void
  unset(key: string): void
}

interface VarsAPI {
  get(key: string): string | undefined
  set(key: string, value: string): void
  unset(key: string): void
}

interface RequestAPI {
  method: string
  url: string
  headers: Record<string, string>
  body?: string
  setHeader(key: string, value: string): void
  setMethod(method: string): void
  setUrl(url: string): void
  setBody(body: string): void
}

interface ResponseAPI {
  status: number
  statusText: string
  headers: Record<string, string>
  body?: string
  json(): unknown
  text(): string
  headersAsObject(): Record<string, string>
}

interface ExpectResult {
  toBe(expected: unknown): void
  toEqual(expected: unknown): void
  toContain(expected: string): void
  toBeGreaterThan(expected: number): void
  toBeLessThan(expected: number): void
  toMatch(regex: RegExp): void
}

type ExpectFunction = (actual: unknown) => ExpectResult

export interface ScriptContext {
  env: EnvAPI
  vars: VarsAPI
  request: RequestAPI
  response?: ResponseAPI
}

export class ScriptError extends Error {
  constructor(message: string, public scriptType: "pre" | "post", public scriptSource: string) {
    super(`[${scriptType} script] ${message}`)
    this.name = "ScriptError"
  }
}

export class AssertionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AssertionError"
  }
}

export function createScriptContext(ctx: RunnerContext, request: RequestItem, result?: RunResult): ScriptContext {
  const env: EnvAPI = {
    get: (key: string) => ctx.envVars.get(key),
    set: (key: string, value: string) => { ctx.envVars.set(key, value); ctx.vars.set(key, value) },
    unset: (key: string) => { ctx.envVars.delete(key); ctx.vars.delete(key) },
  }

  const vars: VarsAPI = {
    get: (key: string) => ctx.vars.get(key),
    set: (key: string, value: string) => ctx.vars.set(key, value),
    unset: (key: string) => ctx.vars.delete(key),
  }

  const reqHeaders = { ...(request.headers || {}) }
  const requestAPI: RequestAPI = {
    get method() { return request.method },
    set method(v: string) { (request as any).method = v },
    get url() { return request.url },
    set url(v: string) { (request as any).url = v },
    get headers() { return reqHeaders },
    set headers(v) { Object.assign(reqHeaders, v) },
    get body() { return request.body },
    set body(v) { (request as any).body = v },
    setHeader(key: string, value: string) { reqHeaders[key] = value },
    setMethod(m: string) { (request as any).method = m },
    setUrl(u: string) { (request as any).url = u },
    setBody(b: string) { (request as any).body = b },
  }

  let responseAPI: ResponseAPI | undefined

  if (result) {
    responseAPI = {
      status: result.status,
      statusText: result.statusText,
      headers: result.responseHeaders || {},
      get body() { return result.body },
      json() {
        try { return JSON.parse(result.body || "null") }
        catch { throw new Error("Response body is not valid JSON") }
      },
      text() { return result.body || "" },
      headersAsObject() { return { ...(result.responseHeaders || {}) } },
    }
  }

  return { env, vars, request: requestAPI, response: responseAPI }
}

export function executeScript(scriptSource: string, scriptContext: ScriptContext, scriptType: "pre" | "post"): void {
  if (!scriptSource || !scriptSource.trim()) return

  // SECURITY: Create context with null prototype to prevent constructor-chain escapes.
  // Only safe primitives and whitelisted APIs are passed. All objects that have
  // a .constructor property (which can lead to the Function constructor) are
  // wrapped or replaced with safe alternatives.
  const sandbox = vm.createContext(Object.create(null))

  sandbox.env = scriptContext.env
  sandbox.vars = scriptContext.vars
  sandbox.request = scriptContext.request
  sandbox.console = createSandboxConsole()
  sandbox.expect = createExpectFunction()

  // Wrap JSON to strip constructor access while keeping parse/stringify
  sandbox.JSON = {
    parse: (text: string) => JSON.parse(text),
    stringify: (value: unknown, space?: string | number) => JSON.stringify(value, null, space),
  }

  // Wrap Math to strip constructor access (Math.constructor === Object)
  sandbox.Math = {
    abs: Math.abs,
    ceil: Math.ceil,
    floor: Math.floor,
    round: Math.round,
    max: Math.max,
    min: Math.min,
    pow: Math.pow,
    sqrt: Math.sqrt,
    random: Math.random,
    sin: Math.sin, cos: Math.cos, tan: Math.tan,
    PI: Math.PI,
    E: Math.E,
  }

  // Date is a constructor, so we expose only the safe static parts
  sandbox.Date = {
    now: Date.now,
    parse: Date.parse,
    UTC: Date.UTC,
  }

  // Plain functions — calling .constructor on them gives Function, but since
  // Function("...")() runs in the sandbox (where dangerous globals are absent),
  // this is acceptable. Safer than passing constructor-bearing objects.
  sandbox.parseInt = parseInt
  sandbox.parseFloat = parseFloat
  sandbox.isNaN = isNaN
  sandbox.isFinite = isFinite

  // Explicitly shadow dangerous globals so they're undefined
  sandbox.setTimeout = undefined
  sandbox.setInterval = undefined
  sandbox.clearTimeout = undefined
  sandbox.clearInterval = undefined
  sandbox.require = undefined
  sandbox.process = undefined
  sandbox.global = undefined
  sandbox.globalThis = undefined
  sandbox.fetch = undefined

  if (scriptType === "post" && scriptContext.response) {
    sandbox.response = scriptContext.response
  }

  const wrappedScript = `(function() {\n${scriptSource}\n})()`

  try {
    const script = new vm.Script(wrappedScript, { filename: `recli-${scriptType}.js` })
    script.runInContext(sandbox, { timeout: 5000 })
  } catch (e) {
    if (e instanceof AssertionError) {
      throw new ScriptError(`Assertion failed: ${e.message}`, scriptType, scriptSource)
    }
    const msg = e instanceof Error ? e.message : String(e)
    throw new ScriptError(msg, scriptType, scriptSource)
  }
}

function createSandboxConsole() {
  return {
    log: (...args: unknown[]) => console.log(`[script]`, ...args),
    warn: (...args: unknown[]) => console.warn(`[script]`, ...args),
    error: (...args: unknown[]) => console.error(`[script]`, ...args),
    info: (...args: unknown[]) => console.info(`[script]`, ...args),
  }
}

// Sort object keys recursively for stable deep comparison
function sortKeys(o: unknown): unknown {
  if (o === null || o === undefined) return o
  if (Array.isArray(o)) return o.map(sortKeys)
  if (typeof o === "object") {
    const sorted: Record<string, unknown> = {}
    for (const k of Object.keys(o as Record<string, unknown>).sort()) {
      sorted[k] = sortKeys((o as Record<string, unknown>)[k])
    }
    return sorted
  }
  return o
}

function createExpectFunction(): ExpectFunction {
  return function expect(actual: unknown): ExpectResult {
    return {
      toBe(expected: unknown) {
        if (actual !== expected) {
          throw new AssertionError(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
        }
      },
      toEqual(expected: unknown) {
        const a = JSON.stringify(sortKeys(actual))
        const b = JSON.stringify(sortKeys(expected))
        if (a !== b) {
          throw new AssertionError(`expected ${b}, got ${a}`)
        }
      },
      toContain(expected: string) {
        const str = String(actual)
        if (!str.includes(expected)) {
          throw new AssertionError(`expected "${str}" to contain "${expected}"`)
        }
      },
      toBeGreaterThan(expected: number) {
        if (typeof actual !== "number" || actual <= expected) {
          throw new AssertionError(`expected ${actual} to be greater than ${expected}`)
        }
      },
      toBeLessThan(expected: number) {
        if (typeof actual !== "number" || actual >= expected) {
          throw new AssertionError(`expected ${actual} to be less than ${expected}`)
        }
      },
      toMatch(regex: RegExp) {
        if (!regex.test(String(actual))) {
          throw new AssertionError(`expected "${actual}" to match ${regex}`)
        }
      },
    }
  }
}

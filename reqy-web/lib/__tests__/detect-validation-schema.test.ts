import { describe, it, expect } from "vitest"
import { analyzeHandlerBody, detectExpress } from "../detect-shared"
import type { DetectedRoute } from "../detect-shared"

function makeRoute(): DetectedRoute {
  return {
    name: "test",
    method: "POST",
    path: "/test",
    headers: [],
    body: "",
    bodyType: "json",
    authRequired: false,
    description: "",
    sourceFile: "test.ts",
  }
}

// ── Zod ──────────────────────────────────────────────────────────────────────

describe("Zod schema detection", () => {
  it("1 — detects Zod schema inline in Express handler", () => {
    const code = `
import express from "express"
const app = express()
app.post("/api/auth/login", (req, res) => {
  const schema = z.object({ email: z.string().email(), password: z.string().min(8) })
  const data = schema.parse(req.body)
  res.json({ token: "abc" })
})
`
    const routes = detectExpress(code)
    expect(routes.length).toBe(1)
    const r = routes[0]
    expect(r.bodyType).toBe("json")
    expect(r.bodyFieldTypes).toBeDefined()
    expect(r.bodyFieldTypes!["email"]).toBe("string")
    expect(r.bodyFieldTypes!["password"]).toBe("string")
    expect(r.requiredBodyFields).toContain("email")
    expect(r.requiredBodyFields).toContain("password")
    expect(r.reasonings?.some((s) => s.includes("Schéma de validation"))).toBe(true)
  })

  it("2 — detects Zod schema declared outside handler and referenced by name", () => {
    const code = `
import express from "express"
import { z } from "zod"

const loginSchema = z.object({
  email: z.string(),
  age: z.number().optional(),
})

const app = express()
app.post("/api/login", (req, res) => {
  const data = loginSchema.parse(req.body)
  res.json(data)
})
`
    const routes = detectExpress(code)
    expect(routes.length).toBe(1)
    const r = routes[0]
    expect(r.bodyType).toBe("json")
    expect(r.bodyFieldTypes).toBeDefined()
    expect(r.bodyFieldTypes!["email"]).toBe("string")
    expect(r.bodyFieldTypes!["age"]).toBe("number")
    expect(r.requiredBodyFields).toContain("email")
    expect(r.requiredBodyFields).not.toContain("age")
  })
})

// ── Joi ──────────────────────────────────────────────────────────────────────

describe("Joi schema detection", () => {
  it("3 — detects Joi schema in handler", () => {
    const code = `
const Joi = require("joi")
const schema = Joi.object({
  email: Joi.string().required(),
  nickname: Joi.string(),
})
router.post("/register", (req, res) => {
  const { error, value } = schema.validate(req.body)
})
`
    const route = makeRoute()
    route.bodyType = "json"
    analyzeHandlerBody(code, route, code)
    expect(route.bodyType).toBe("json")
    expect(route.bodyFieldTypes).toBeDefined()
    expect(route.bodyFieldTypes!["email"]).toBe("string")
    expect(route.bodyFieldTypes!["nickname"]).toBe("string")
    expect(route.requiredBodyFields).toContain("email")
    expect(route.requiredBodyFields).not.toContain("nickname")
  })
})

// ── express-validator ────────────────────────────────────────────────────────

describe("express-validator detection", () => {
  it("4 — detects body() chains in middleware array", () => {
    const code = `router.post("/signup",
  [
    body("email").isEmail(),
    body("age").isInt().optional(),
  ],
  (req, res) => { res.json({ ok: true }) }
)`
    const route = makeRoute()
    route.bodyType = "json"
    analyzeHandlerBody(code, route, code)
    expect(route.bodyType).toBe("json")
    expect(route.bodyFieldTypes).toBeDefined()
    expect(route.bodyFieldTypes!["email"]).toBe("string")
    expect(route.bodyFieldTypes!["age"]).toBe("number")
    expect(route.requiredBodyFields).toContain("email")
    expect(route.requiredBodyFields).not.toContain("age")
  })
})

// ── class-validator (NestJS) ────────────────────────────────────────────────

describe("class-validator detection", () => {
  it("5 — detects DTO with class-validator decorators", () => {
    const code = `
import { IsEmail, IsString, IsOptional } from "class-validator"

class CreateUserDto {
  @IsEmail()
  email: string

  @IsOptional()
  @IsString()
  nickname?: string
}

@Controller()
class UserController {
  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.userService.create(dto)
  }
}
`
    const route = makeRoute()
    route.bodyType = "json"
    analyzeHandlerBody(code, route, code)
    expect(route.bodyType).toBe("json")
    expect(route.bodyFieldTypes).toBeDefined()
    expect(route.bodyFieldTypes!["email"]).toBe("string")
    expect(route.bodyFieldTypes!["nickname"]).toBe("string")
    expect(route.requiredBodyFields).toContain("email")
    expect(route.requiredBodyFields).not.toContain("nickname")
  })
})

// ── Fallback ─────────────────────────────────────────────────────────────────

describe("fallback to extractBodyFields", () => {
  it("6 — uses extractBodyFields when no validation schema is detected", () => {
    const code = `
import express from "express"
const app = express()
app.post("/api/legacy", (req, res) => {
  const { email, password } = req.body
  res.json({ ok: true })
})
`
    const routes = detectExpress(code)
    expect(routes.length).toBe(1)
    const r = routes[0]
    expect(r.bodyType).toBe("json")
    expect(r.bodyFieldTypes).toBeUndefined()
    expect(r.requiredBodyFields).toBeUndefined()
    expect(r.body).toContain("email")
    expect(r.body).toContain("password")
  })
})

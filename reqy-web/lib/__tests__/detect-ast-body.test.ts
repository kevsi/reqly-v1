import { describe, it, expect } from "vitest"
import { detectExpress } from "@/lib/detect-shared"

describe("detectExpress AST body detection", () => {
  it("detects JSON body from Express route handler with middleware", () => {
    const code = `
import express from "express"
const app = express()
app.post("/api/auth/login", authMiddleware, (req, res) => {
  const { email, password } = req.body
  res.json({ token: "abc" })
})
`
    const routes = detectExpress(code)
    expect(routes.length).toBe(1)
    const route = routes[0]
    expect(route.method).toBe("POST")
    expect(route.path).toBe("/api/auth/login")
    expect(route.bodyType).toBe("json")
    expect(route.body).toContain("email")
    expect(route.body).toContain("password")
  })

  it("detects JSON body from Express route handler without middleware", () => {
    const code = `
import express from "express"
const app = express()
app.patch("/api/users/:id", async (req, res) => {
  const { name, email, role } = req.body
  await db.updateUser(req.params.id, { name, email, role })
  res.json({ ok: true })
})
`
    const routes = detectExpress(code)
    expect(routes.length).toBe(1)
    const route = routes[0]
    expect(route.method).toBe("PATCH")
    expect(route.bodyType).toBe("json")
    expect(route.body).toContain("name")
    expect(route.body).toContain("email")
    expect(route.body).toContain("role")
  })

  it("leaves bodyType as none when handler has no body access", () => {
    const code = `
import express from "express"
const router = express.Router()
router.get("/health", (req, res) => {
  res.json({ status: "ok" })
})
`
    const routes = detectExpress(code)
    expect(routes.length).toBe(1)
    const route = routes[0]
    expect(route.bodyType).toBe("none")
    expect(route.body).toBe("")
  })
})

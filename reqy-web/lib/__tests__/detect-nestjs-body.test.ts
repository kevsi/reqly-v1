import { describe, it, expect } from "vitest"
import { detectNestJS } from "../detect-shared"

describe("NestJS body detection", () => {
  it("detects body from @Body() with DTO type (AST path)", () => {
    const code = `
import { Controller, Post, Body } from "@nestjs/common"
import { IsEmail, IsString } from "class-validator"

class CreateUserDto {
  @IsEmail() email: string
  @IsString() name: string
}

@Controller("users")
export class UserController {
  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.service.create(dto)
  }
}
`
    const routes = detectNestJS(code)
    expect(routes.length).toBeGreaterThanOrEqual(1)
    const r = routes.find(r => r.method === "POST" && r.path === "/users")
    expect(r).toBeDefined()
    expect(r!.bodyType).toBe("json")
    expect(r!.body).toContain("email")
    expect(r!.body).toContain("name")
  })

  it("detects body when @Body() has no DTO type", () => {
    const code = `
import { Controller, Post, Body } from "@nestjs/common"

@Controller()
export class AppController {
  @Post("login")
  login(@Body() body: Record<string, any>) {
    return { ok: true }
  }
}
`
    const routes = detectNestJS(code)
    expect(routes.length).toBeGreaterThanOrEqual(1)
    const r = routes.find(r => r.method === "POST" && r.path === "/login")
    expect(r).toBeDefined()
    expect(r!.bodyType).toBe("json")
  })

  it("leaves bodyType as none when no @Body() decorator", () => {
    const code = `
import { Controller, Get } from "@nestjs/common"

@Controller("health")
export class HealthController {
  @Get()
  check() {
    return { status: "ok" }
  }
}
`
    const routes = detectNestJS(code)
    expect(routes.length).toBeGreaterThanOrEqual(1)
    const r = routes.find(r => r.method === "GET")
    expect(r).toBeDefined()
    expect(r!.bodyType).toBe("none")
  })
})

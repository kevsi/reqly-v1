import { describe, it, expect } from "vitest"
import { parseCurlCommand, generateCurlCommand } from "../index.js"

describe("parseCurlCommand", () => {
  it("parse un GET simple", () => {
    const result = parseCurlCommand("curl https://api.example.com/users")
    expect(result).not.toBeNull()
    expect(result!.method).toBe("GET")
    expect(result!.url).toBe("https://api.example.com/users")
  })

  it("parse un POST avec headers et body", () => {
    const input = `curl -X POST https://api.example.com/users -H "Content-Type: application/json" -d '{"name":"test"}'`
    const result = parseCurlCommand(input)
    expect(result).not.toBeNull()
    expect(result!.method).toBe("POST")
    expect(result!.url).toBe("https://api.example.com/users")
    expect(result!.headers["Content-Type"]).toBe("application/json")
    expect(result!.body).toBe('{"name":"test"}')
  })

  it("parse l'auth basique -u user:pass", () => {
    const result = parseCurlCommand("curl -u user:pass https://api.example.com/api")
    expect(result).not.toBeNull()
    expect(result!.auth).toEqual({ type: "basic", username: "user", password: "pass" })
  })

  it("parse PUT avec --data-raw", () => {
    const result = parseCurlCommand('curl -X PUT https://api.example.com/item/1 --data-raw "updated"')
    expect(result).not.toBeNull()
    expect(result!.method).toBe("PUT")
    expect(result!.body).toBe("updated")
  })

  it("retourne null pour une commande invalide sans URL", () => {
    const result = parseCurlCommand("curl -X GET")
    expect(result).toBeNull()
  })

  it("gère les headers multiples", () => {
    const input = `curl -H "Accept: application/json" -H "Authorization: Bearer tok" https://api.example.com`
    const result = parseCurlCommand(input)
    expect(result).not.toBeNull()
    expect(result!.headers["Accept"]).toBe("application/json")
    expect(result!.headers["Authorization"]).toBe("Bearer tok")
  })

  it("gère --data= inline", () => {
    const result = parseCurlCommand('curl -X POST https://api.example.com --data={"key":"val"}')
    expect(result).not.toBeNull()
    expect(result!.body).toBe('{"key":"val"}')
  })

  it("gère les guillemets simples dans le body", () => {
    const result = parseCurlCommand("curl -d 'hello world' https://api.example.com")
    expect(result).not.toBeNull()
    expect(result!.body).toBe("hello world")
  })
})

describe("generateCurlCommand", () => {
  it("génère un GET sans options inutiles", () => {
    const cmd = generateCurlCommand({ method: "GET", url: "https://api.example.com" })
    expect(cmd).toBe("curl https://api.example.com")
  })

  it("génère un POST avec -X et body", () => {
    const cmd = generateCurlCommand({
      method: "POST",
      url: "https://api.example.com/users",
      body: '{"name":"test"}',
    })
    expect(cmd).toContain("-X POST")
    expect(cmd).toContain("-d")
    expect(cmd).toContain('{"name":"test"}')
  })

  it("génère un Bearer token", () => {
    const cmd = generateCurlCommand({
      method: "GET",
      url: "https://api.example.com/me",
      authType: "bearer",
      authToken: "tok123",
    })
    expect(cmd).toContain("Authorization: Bearer tok123")
  })

  it("inclut le header personnalisé", () => {
    const cmd = generateCurlCommand({
      method: "GET",
      url: "https://api.example.com",
      headers: { "X-Custom": "val" },
    })
    expect(cmd).toContain("-H")
    expect(cmd).toContain("X-Custom: val")
  })
})

import { describe, it, expect, beforeAll, afterAll } from "vitest"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { loadConfig } from "./config.js"

let tmpDir: string

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "recli-test-"))
})

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

function writeConfig(filename: string, content: string) {
  fs.writeFileSync(path.join(tmpDir, filename), content, "utf8")
}

describe("config", () => {
  describe("loadConfig", () => {
    it("returns empty object when no config file exists", () => {
      const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "recli-empty-"))
      const config = loadConfig(emptyDir)
      expect(config).toEqual({})
      fs.rmSync(emptyDir, { recursive: true, force: true })
    })

    it("loads JSON config file", () => {
      writeConfig(".reclirc.json", JSON.stringify({
        env: "staging",
        timeout: 15000,
        parallel: true,
        reporter: "html",
      }))
      const config = loadConfig(tmpDir)
      expect(config.env).toBe("staging")
      expect(config.timeout).toBe(15000)
      expect(config.parallel).toBe(true)
      expect(config.reporter).toBe("html")
    })

    it("loads recli.config.json file", () => {
      const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "recli-config-"))
      writeConfig("recli.config.json", JSON.stringify({
        env: "production",
        timeout: 30000,
      }))
      fs.cpSync(path.join(tmpDir, "recli.config.json"), path.join(configDir, "recli.config.json"))

      const config = loadConfig(configDir)
      expect(config.env).toBe("production")
      expect(config.timeout).toBe(30000)
      fs.rmSync(configDir, { recursive: true, force: true })
    })

    it("loads .reclirc as key=value format", () => {
      const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "recli-kv-"))
      writeConfig(".reclirc", [
        "env=development",
        "timeout=5000",
        "parallel=true",
        "reporter=junit",
      ].join("\n"))
      fs.cpSync(path.join(tmpDir, ".reclirc"), path.join(configDir, ".reclirc"))

      const config = loadConfig(configDir)
      expect(config.env).toBe("development")
      expect(config.timeout).toBe(5000)
      expect(config.parallel).toBe(true)
      expect(config.reporter).toBe("junit")
      fs.rmSync(configDir, { recursive: true, force: true })
    })

    it("ignores comments in key=value format", () => {
      const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "recli-comment-"))
      writeConfig(".reclirc", [
        "# this is a comment",
        "env=test",
        "# another comment",
      ].join("\n"))
      fs.cpSync(path.join(tmpDir, ".reclirc"), path.join(configDir, ".reclirc"))

      const config = loadConfig(configDir)
      expect(config.env).toBe("test")
      fs.rmSync(configDir, { recursive: true, force: true })
    })

    it("loads YAML config", () => {
      const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "recli-yaml-"))
      writeConfig(".reclirc.yaml", [
        "env: production",
        "timeout: 20000",
        "parallel: true",
      ].join("\n"))
      fs.cpSync(path.join(tmpDir, ".reclirc.yaml"), path.join(configDir, ".reclirc.yaml"))

      const config = loadConfig(configDir)
      expect(config.env).toBe("production")
      expect(config.timeout).toBe(20000)
      expect(config.parallel).toBe(true)
      fs.rmSync(configDir, { recursive: true, force: true })
    })

    it("prioritizes first config file found walking up", () => {
      const subDir = fs.mkdtempSync(path.join(os.tmpdir(), "recli-sub-"))
      writeConfig("recli.config.json", JSON.stringify({ env: "parent" }))
      fs.cpSync(path.join(tmpDir, "recli.config.json"), path.join(subDir, "recli.config.json"))

      const config = loadConfig(subDir)
      expect(config.env).toBe("parent")
      fs.rmSync(subDir, { recursive: true, force: true })
    })
  })
})

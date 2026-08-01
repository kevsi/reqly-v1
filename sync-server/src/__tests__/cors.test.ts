import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { parseOrigins } from "../cors.js";

const ORIGINAL_ENV = { ...process.env };

describe("parseOrigins", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.ALLOWED_ORIGIN;
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("returns default origins when ALLOWED_ORIGIN is unset", () => {
    const origins = parseOrigins();
    expect(origins).not.toBe("*");
    expect(Array.isArray(origins)).toBe(true);
    if (Array.isArray(origins)) {
      expect(origins).toContain("http://localhost:3000");
      expect(origins).toContain("tauri://localhost");
    }
  });

  it("returns the wildcard when ALLOWED_ORIGIN=*", () => {
    process.env.ALLOWED_ORIGIN = "*";
    expect(parseOrigins()).toBe("*");
  });

  it("splits comma-separated origins", () => {
    process.env.ALLOWED_ORIGIN = "https://app.example.com, https://api.example.com";
    const origins = parseOrigins();
    expect(origins).not.toBe("*");
    if (Array.isArray(origins)) {
      expect(origins).toHaveLength(2);
      expect(origins[0]).toBe("https://app.example.com");
      expect(origins[1]).toBe("https://api.example.com");
    }
  });

  it("filters empty entries after comma splitting", () => {
    process.env.ALLOWED_ORIGIN = "https://app.example.com,,  ";
    const origins = parseOrigins();
    expect(origins).not.toBe("*");
    if (Array.isArray(origins)) {
      expect(origins).toHaveLength(1);
    }
  });

  it("warns when ALLOWED_ORIGIN=* in production", () => {
    process.env.ALLOWED_ORIGIN = "*";
    process.env.NODE_ENV = "production";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(parseOrigins()).toBe("*");
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ALLOWED_ORIGIN=*"));

    warn.mockRestore();
  });
});

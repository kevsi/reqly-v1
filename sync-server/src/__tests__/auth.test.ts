import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHmac } from "node:crypto";
import { parseSessionCookie, requireAuth, escapeRegex } from "../auth.js";

// Helper: build a signed session cookie using the same algorithm as auth.ts.
function makeCookie(
  payload: {
    email: string;
    name: string;
    provider: string;
    userId?: string;
    expires: number;
    ver?: number;
  },
  secret = process.env.AUTH_SIGNING_SECRET,
): string {
  if (!secret) throw new Error("AUTH_SIGNING_SECRET not set in test env");
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

describe("auth — parseSessionCookie", () => {
  beforeEach(() => {
    process.env.AUTH_SIGNING_SECRET = "test-secret-do-not-use-in-prod";
  });

  it("returns null for an undefined cookie", () => {
    expect(parseSessionCookie(undefined)).toBeNull();
  });

  it("returns null for an empty cookie", () => {
    expect(parseSessionCookie("")).toBeNull();
  });

  it("returns null for a malformed cookie (no separator)", () => {
    expect(parseSessionCookie("just-a-single-blob")).toBeNull();
  });

  it("returns null when the signature is missing", () => {
    const encoded = Buffer.from(
      JSON.stringify({ email: "a@x", name: "A", provider: "github", expires: Date.now() + 60_000 }),
    ).toString("base64url");
    expect(parseSessionCookie(encoded)).toBeNull();
  });

  it("returns null when the payload is missing", () => {
    expect(parseSessionCookie(".someSignature")).toBeNull();
  });

  it("returns null when the signature is wrong", () => {
    const cookie = makeCookie({
      email: "a@x",
      name: "A",
      provider: "github",
      userId: "u-1",
      expires: Date.now() + 60_000,
    });
    // Flip the last char of the signature
    const tampered = cookie.slice(0, -1) + (cookie.endsWith("A") ? "B" : "A");
    expect(parseSessionCookie(tampered)).toBeNull();
  });

  it("returns null when the cookie was signed with a different secret", () => {
    const cookie = makeCookie(
      {
        email: "a@x",
        name: "A",
        provider: "github",
        userId: "u-1",
        expires: Date.now() + 60_000,
      },
      "wrong-secret",
    );
    expect(parseSessionCookie(cookie)).toBeNull();
  });

  it("returns null when the cookie has expired", () => {
    const cookie = makeCookie({
      email: "a@x",
      name: "A",
      provider: "github",
      userId: "u-1",
      expires: Date.now() - 1_000,
    });
    expect(parseSessionCookie(cookie)).toBeNull();
  });

  it("returns null when the payload is not valid JSON", () => {
    // Encode the literal string "not json" as base64url and sign it
    const garbage = Buffer.from("not json").toString("base64url");
    const sig = createHmac("sha256", process.env.AUTH_SIGNING_SECRET!)
      .update(garbage)
      .digest("base64url");
    expect(parseSessionCookie(`${garbage}.${sig}`)).toBeNull();
  });

  it("returns the payload when the cookie is valid and unexpired", () => {
    const cookie = makeCookie({
      email: "user@example.com",
      name: "User",
      provider: "github",
      userId: "u-42",
      expires: Date.now() + 60_000,
    });
    const payload = parseSessionCookie(cookie);
    expect(payload).not.toBeNull();
    expect(payload?.email).toBe("user@example.com");
    expect(payload?.name).toBe("User");
    expect(payload?.provider).toBe("github");
    expect(payload?.userId).toBe("u-42");
  });

  it("tolerates very recent expirations (still in the future)", () => {
    const cookie = makeCookie({
      email: "a@x",
      name: "A",
      provider: "github",
      userId: "u-1",
      expires: Date.now() + 5, // 5 ms in the future
    });
    expect(parseSessionCookie(cookie)).not.toBeNull();
  });
});

describe("auth — requireAuth middleware", () => {
  beforeEach(() => {
    process.env.AUTH_SIGNING_SECRET = "test-secret-do-not-use-in-prod";
  });

  type MockContext = {
    req: { header: (name: string) => string | undefined };
    set: (key: string, value: unknown) => void;
    json: (body: unknown, status: number) => Response;
  };

  function makeContext(cookieHeader?: string): MockContext {
    const headers: Record<string, string> = {};
    if (cookieHeader) headers.cookie = cookieHeader;
    return {
      req: {
        header: (name: string) => headers[name.toLowerCase()],
      },
      set: vi.fn(),
      json: vi.fn((body: unknown, status: number) => ({ body, status }) as unknown as Response),
    };
  }

  it("returns 401 when no cookie header is present", async () => {
    const c = makeContext();
    const next = vi.fn();
    await requireAuth(c as any, next as any);
    expect(c.json).toHaveBeenCalledWith({ error: "Unauthorized" }, 401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when the cookie has an invalid signature", async () => {
    const cookie = makeCookie({
      email: "a@x",
      name: "A",
      provider: "github",
      userId: "u-1",
      expires: Date.now() + 60_000,
    });
    const tampered = cookie.slice(0, -1) + (cookie.endsWith("A") ? "B" : "A");
    const c = makeContext(`auth_session=${tampered}`);
    const next = vi.fn();
    await requireAuth(c as any, next as any);
    expect(c.json).toHaveBeenCalledWith({ error: "Unauthorized" }, 401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when the session has no userId", async () => {
    const cookie = makeCookie({
      email: "a@x",
      name: "A",
      provider: "github",
      // userId intentionally omitted
      expires: Date.now() + 60_000,
    });
    const c = makeContext(`auth_session=${cookie}`);
    const next = vi.fn();
    await requireAuth(c as any, next as any);
    expect(c.json).toHaveBeenCalledWith({ error: "Unauthorized" }, 401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when the session is expired", async () => {
    const cookie = makeCookie({
      email: "a@x",
      name: "A",
      provider: "github",
      userId: "u-1",
      expires: Date.now() - 1_000,
    });
    const c = makeContext(`auth_session=${cookie}`);
    const next = vi.fn();
    await requireAuth(c as any, next as any);
    expect(c.json).toHaveBeenCalledWith({ error: "Unauthorized" }, 401);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() and stores auth context for a valid session", async () => {
    const db = (await import("../db.js")).default;
    db.prepare("INSERT OR IGNORE INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)").run(
      "u-42",
      "user@example.com",
      "User",
      1,
    );
    const cookie = makeCookie({
      email: "user@example.com",
      name: "User",
      provider: "github",
      userId: "u-42",
      expires: Date.now() + 60_000,
      ver: 0,
    });
    const c = makeContext(`auth_session=${cookie}`);
    const next = vi.fn();
    await requireAuth(c as any, next as any);
    expect(next).toHaveBeenCalledOnce();
    expect(c.set).toHaveBeenCalledWith("auth", {
      userId: "u-42",
      email: "user@example.com",
      name: "User",
    });
  });

  it("extracts the cookie value from a header with multiple cookies", async () => {
    const db = (await import("../db.js")).default;
    db.prepare("INSERT OR IGNORE INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)").run(
      "u-1",
      "a@x",
      "A",
      1,
    );
    const session = makeCookie({
      email: "a@x",
      name: "A",
      provider: "github",
      userId: "u-1",
      expires: Date.now() + 60_000,
      ver: 0,
    });
    const c = makeContext(`other=value; auth_session=${session}; theme=dark`);
    const next = vi.fn();
    await requireAuth(c as any, next as any);
    expect(next).toHaveBeenCalledOnce();
    expect(c.set).toHaveBeenCalledWith("auth", {
      userId: "u-1",
      email: "a@x",
      name: "A",
    });
  });

  it("returns 401 for a legacy token without `ver` (cannot be revoked ⇒ rejected)", async () => {
    const db = (await import("../db.js")).default;
    db.prepare("INSERT OR IGNORE INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)").run(
      "u-legacy",
      "legacy@example.com",
      "Legacy",
      1,
    );
    const cookie = makeCookie({
      email: "legacy@example.com",
      name: "Legacy",
      provider: "github",
      userId: "u-legacy",
      expires: Date.now() + 60_000,
      // ver intentionally omitted — pre-migration token, unrevocable
    });
    const c = makeContext(`auth_session=${cookie}`);
    const next = vi.fn();
    await requireAuth(c as any, next as any);
    expect(c.json).toHaveBeenCalledWith({ error: "Unauthorized" }, 401);
    expect(next).not.toHaveBeenCalled();
  });

  describe("escapeRegex", () => {
    it("passes through alphanumeric strings unchanged", () => {
      expect(escapeRegex("auth_session")).toBe("auth_session");
      expect(escapeRegex("hello123")).toBe("hello123");
    });

    it("escapes dots", () => {
      expect(escapeRegex("my.cookie")).toBe("my\\.cookie");
    });

    it("escapes special regex characters", () => {
      expect(escapeRegex("[test]")).toBe("\\[test\\]");
      expect(escapeRegex("(group)")).toBe("\\(group\\)");
      expect(escapeRegex("a+b?")).toBe("a\\+b\\?");
      expect(escapeRegex("^start$")).toBe("\\^start\\$");
    });

    it("escapes backslash", () => {
      expect(escapeRegex("a\\b")).toBe("a\\\\b");
    });

    it("produces a pattern that works in new RegExp", () => {
      const pattern = escapeRegex("session.id");
      const re = new RegExp(`${pattern}=([^;]+)`);
      const match = "session.id=abc123".match(re);
      expect(match?.[1]).toBe("abc123");
    });
  });
});

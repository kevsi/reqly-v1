import { describe, it, expect, vi, afterEach } from "vitest";
import dns from "node:dns";
import { isPrivateIp, isUrlAllowed, executeRequest } from "../runner.js";
import type { RunnerContext } from "../types.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function ctx(): RunnerContext {
  return { vars: new Map(), envVars: new Map(), cookies: new Map(), iteration: 0 };
}

describe("isPrivateIp", () => {
  it("blocks classic private IPv4", () => {
    expect(isPrivateIp("127.0.0.1")).toBe(true);
    expect(isPrivateIp("10.1.2.3")).toBe(true);
    expect(isPrivateIp("172.16.0.1")).toBe(true);
    expect(isPrivateIp("192.168.1.1")).toBe(true);
    expect(isPrivateIp("169.254.169.254")).toBe(true);
    expect(isPrivateIp("8.8.8.8")).toBe(false);
  });

  it("blocks numeric/short/hex/octal IPv4 forms that resolve to private hosts", () => {
    expect(isPrivateIp("127.1")).toBe(true); // 127.0.0.1
    expect(isPrivateIp("2130706433")).toBe(true); // 127.0.0.1
    expect(isPrivateIp("0x7f000001")).toBe(true); // 127.0.0.1
    expect(isPrivateIp("0177.0.0.1")).toBe(true); // octal 127.0.0.1
    expect(isPrivateIp("127.0.1")).toBe(true); // 127.0.0.1
    expect(isPrivateIp("0x64400001")).toBe(true); // 100.64.0.1 (CGNAT)
  });

  it("blocks private IPv6 forms", () => {
    expect(isPrivateIp("::1")).toBe(true);
    expect(isPrivateIp("::")).toBe(true);
    expect(isPrivateIp("fc00::1")).toBe(true); // ULA
    expect(isPrivateIp("fd12:3456::1")).toBe(true); // ULA
    expect(isPrivateIp("fe80::1")).toBe(true); // link-local
    expect(isPrivateIp("ff02::1")).toBe(true); // multicast
    expect(isPrivateIp("2001:4860:4860::8888")).toBe(false); // public Google DNS
  });

  it("blocks IPv4-mapped IPv6 pointing at private hosts", () => {
    expect(isPrivateIp("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateIp("::ffff:7f00:1")).toBe(true);
    expect(isPrivateIp("::ffff:169.254.169.254")).toBe(true);
    expect(isPrivateIp("::ffff:8.8.8.8")).toBe(false);
  });
});

describe("isUrlAllowed", () => {
  it("allows a public URL", async () => {
    await expect(isUrlAllowed("https://example.com/path")).resolves.toEqual({ allowed: true });
  });

  it("blocks private IP literals", async () => {
    const res = await isUrlAllowed("http://127.0.0.1:4000/api");
    expect(res.allowed).toBe(false);
    expect(res.reason).toMatch(/Private/);
  });

  it("blocks non-http protocols", async () => {
    const res = await isUrlAllowed("file:///etc/passwd");
    expect(res.allowed).toBe(false);
    expect(res.reason).toMatch(/protocol/i);
  });

  it("blocks a hostname that resolves to a private address (DNS rebinding)", async () => {
    vi.spyOn(dns.promises, "lookup").mockResolvedValue([
      { address: "127.0.0.1", family: 4 },
    ] as never);
    const res = await isUrlAllowed("https://evil.example.com/");
    expect(res.allowed).toBe(false);
    expect(res.reason).toMatch(/127\.0\.0\.1/);
  });

  it("allows a hostname resolving only to public addresses", async () => {
    vi.spyOn(dns.promises, "lookup").mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ] as never);
    await expect(isUrlAllowed("https://example.com/")).resolves.toEqual({ allowed: true });
  });

  it("short-circuits when allowLocalHosts is set", async () => {
    await expect(isUrlAllowed("http://127.0.0.1:4000", true)).resolves.toEqual({ allowed: true });
  });
});

describe("SSRF redirect protection", () => {
  it("blocks a redirect to a private address", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response("", {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data/" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeRequest(
      { name: "r", method: "GET", url: "https://httpbin.org/redirect", endpoint: "/redirect" },
      ctx(),
      5000,
      { timeoutMs: 5000 },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1); // never follows the redirect
    expect(result.status).toBe(0);
    expect(result.statusText).toBe("Blocked");
    expect(result.error).toMatch(/169\.254\.169\.254/);
  });

  it("allows a redirect to another public host", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("", { status: 302, headers: { location: "https://example.com/final" } }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeRequest(
      { name: "r", method: "GET", url: "https://httpbin.org/redirect", endpoint: "/redirect" },
      ctx(),
      5000,
      { timeoutMs: 5000 },
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.status).toBe(200);
  });
});

describe("SSRF pre-script protection", () => {
  it("blocks a pre-script that rewrites the URL to a private address", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeRequest(
      {
        name: "r",
        method: "GET",
        url: "https://httpbin.org/get",
        endpoint: "/get",
        scripts: { pre: 'pm.request.url = "http://127.0.0.1:6379/"' },
      },
      ctx(),
      5000,
      { timeoutMs: 5000 },
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.status).toBe(0);
    expect(result.statusText).toBe("Blocked");
  });
});

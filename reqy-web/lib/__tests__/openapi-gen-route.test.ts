import { describe, it, expect, vi, afterEach } from "vitest";
import JSZip from "jszip";
import { POST } from "@/app/api/sdk-generate/route";

vi.mock("@/lib/security/dns-cache", async () => {
  const actual = await vi.importActual<typeof import("@/lib/security/dns-cache")>(
    "@/lib/security/dns-cache",
  );
  return {
    ...actual,
    resolveCached: vi.fn(async (hostname: string) =>
      hostname === "private.example" ? "10.0.0.5" : "93.184.216.34",
    ),
  };
});

// The route creates a module-level in-memory rate limiter (10 req/min) that
// would trip across the file's many requests. Replace the factory so the
// suite exercises the request logic, not the limiter (tested separately).
vi.mock("@/lib/rate-limiter", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rate-limiter")>("@/lib/rate-limiter");
  return {
    ...actual,
    createRateLimiter: () => ({
      check: () => ({ allowed: true, remaining: 10, resetAt: Date.now() + 60_000 }),
    }),
  };
});

function fakeResponse(body: unknown, status = 200, headers?: Record<string, string>) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers ?? {}),
    async text() {
      return text;
    },
    async json() {
      return typeof body === "string" ? JSON.parse(body) : body;
    },
    async blob() {
      return new Blob([text]);
    },
    async arrayBuffer() {
      return new TextEncoder().encode(text).buffer;
    },
  };
}

function makeReq(payload: unknown) {
  return {
    json: async () => payload,
    signal: new AbortController().signal,
  } as unknown as Request;
}

afterEach(() => vi.unstubAllGlobals());

describe("sdk-generate route", () => {
  it("proxies to the default cloud generator and returns the zip", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(fakeResponse({ link: "https://x/z.zip" }));
    fetchMock.mockResolvedValueOnce(fakeResponse("zipbytes"));
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(makeReq({ spec: { openapi: "3.0.3" }, language: "python" }));

    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toContain("api.openapi-generator.tech");
  });

  it("uses a custom baseUrl when provided (self-hosted)", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(fakeResponse({ link: "https://x/z.zip" }));
    fetchMock.mockResolvedValueOnce(fakeResponse("zipbytes"));
    vi.stubGlobal("fetch", fetchMock);

    await POST(makeReq({ spec: {}, language: "python", baseUrl: "https://self.host/x" }));

    expect(fetchMock.mock.calls[0][0]).toBe("https://self.host/x/python");
  });

  it("returns 502 when the generator errors", async () => {
    const fetchMock = vi.fn(async () => fakeResponse("err", 500));
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(makeReq({ spec: {}, language: "python" }));

    expect(res.status).toBe(502);
  });

  it("returns 400 when inputs are missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(makeReq({ language: "python" }));

    expect(res.status).toBe(400);
  });

  it("uses the apiName from the body when provided", async () => {
    const zip = new JSZip();
    zip.file("index.ts", "export {}");
    const zipBytes = await zip.generateAsync({ type: "uint8array" });
    const zipBuf = zipBytes.buffer.slice(
      zipBytes.byteOffset,
      zipBytes.byteOffset + zipBytes.byteLength,
    );

    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(fakeResponse({ link: "https://x/z.zip" }));
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      async arrayBuffer() {
        return zipBuf;
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(
      makeReq({
        spec: { openapi: "3.0.3", info: { title: "Reqly API Collections" } },
        language: "typescript-fetch",
        apiName: "Billing",
      }),
    );

    expect(res.status).toBe(200);
    const out = await JSZip.loadAsync(await res.arrayBuffer());
    const pkg = JSON.parse(await out.file("package.json")!.async("string"));
    expect(pkg.name).toBe("reqly-billing");
  });

  it("enriches the generated zip with build manifests (e.g. package.json)", async () => {
    const zip = new JSZip();
    zip.file("index.ts", "export {}");
    zip.file("runtime.ts", "// runtime");
    const zipBytes = await zip.generateAsync({ type: "uint8array" });
    const zipBuf = zipBytes.buffer.slice(
      zipBytes.byteOffset,
      zipBytes.byteOffset + zipBytes.byteLength,
    );

    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(fakeResponse({ link: "https://x/z.zip" }));
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      async arrayBuffer() {
        return zipBuf;
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(
      makeReq({
        spec: { openapi: "3.0.3", info: { title: "General" } },
        language: "typescript-fetch",
      }),
    );

    expect(res.status).toBe(200);
    const out = await JSZip.loadAsync(await res.arrayBuffer());
    expect(out.file("package.json")).toBeTruthy();
    const pkg = JSON.parse(await out.file("package.json")!.async("string"));
    expect(pkg.name).toBe("reqly-general");
    // original files preserved
    expect(out.file("index.ts")).toBeTruthy();
  });

  it("allows dart (matches the UI language grid)", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(fakeResponse({ link: "https://x/z.zip" }));
    fetchMock.mockResolvedValueOnce(fakeResponse("zipbytes"));
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(makeReq({ spec: { openapi: "3.0.3" }, language: "dart" }));
    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/dart$/);
  });

  it("blocks download links pointing to private IPs", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(fakeResponse({ link: "http://10.0.0.5/evil.zip" }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(makeReq({ spec: {}, language: "python" }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/blocked/i);
  });

  it("blocks download links that resolve to private IPs after DNS", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(fakeResponse({ link: "http://private.example/evil.zip" }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(makeReq({ spec: {}, language: "python" }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/blocked/i);
  });

  it("rejects download links with an invalid protocol", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(fakeResponse({ link: "file:///etc/passwd" }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(makeReq({ spec: {}, language: "python" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/protocol/i);
  });

  it("blocks redirects from the download URL to private IPs", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(fakeResponse({ link: "https://public.example/z.zip" }));
    fetchMock.mockResolvedValueOnce(
      fakeResponse("", 302, { Location: "http://192.168.1.10/evil" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(makeReq({ spec: {}, language: "python" }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/blocked/i);
  });
});

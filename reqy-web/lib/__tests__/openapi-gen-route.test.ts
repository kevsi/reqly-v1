import { describe, it, expect, vi, afterEach } from "vitest";
import JSZip from "jszip";
import { POST } from "@/app/api/sdk-generate/route";

function fakeResponse(body: unknown, status = 200) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
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
  return { json: async () => payload } as unknown as Request;
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
});

import { describe, it, expect, vi, afterEach } from "vitest";
import { generateSdk } from "@/lib/openapi-gen/generator";

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
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("generateSdk", () => {
  it("always proxies through the same-origin route (avoids CORS + mixed-content download)", async () => {
    const fetchMock = vi.fn(async () => fakeResponse("zipbytes"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateSdk({ openapi: "3.0.3" }, "typescript-fetch", "myapi", {
      baseUrl: "https://self-host.example.com/api/gen/clients",
      generatorOptions: { supportsES6: true },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/sdk-generate");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.language).toBe("typescript-fetch");
    expect(body.options).toEqual({ supportsES6: true });
    expect(body.baseUrl).toBe("https://self-host.example.com/api/gen/clients");
    expect(result.filename).toBe("myapi-typescript-fetch.zip");
  });

  it("defaults to the route with no baseUrl", async () => {
    const fetchMock = vi.fn(async () => fakeResponse("zipbytes"));
    vi.stubGlobal("fetch", fetchMock);

    await generateSdk({ openapi: "3.0.3" }, "python", "api");

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.baseUrl).toBeUndefined();
  });

  it("surfaces a clear error when the route returns an error", async () => {
    const fetchMock = vi.fn(async () => fakeResponse({ error: "boom" }, 500));
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateSdk({}, "python", "api")).rejects.toThrow(
      /SDK generation failed \(500\): boom/,
    );
  });

  it("reports a network failure to the route clearly", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateSdk({}, "python", "api")).rejects.toThrow(
      /Could not reach the SDK generation endpoint/,
    );
  });

  it("reports a timeout as such", async () => {
    const fetchMock = vi.fn(async () => {
      throw new DOMException("aborted", "AbortError");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateSdk({}, "python", "api", { timeoutMs: 1000 })).rejects.toThrow(
      /timed out/,
    );
  });
});

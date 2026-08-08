import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/security/dns-cache", () => ({
  resolveCached: vi.fn(async (hostname: string) => {
    if (
      hostname === "example.com" ||
      hostname === "myproxy.example.com" ||
      hostname === "ollama.example.com"
    ) {
      return "93.184.216.34";
    }
    return null;
  }),
}));

import { handleOllama } from "../handlers/ollama";

const validBody = {
  provider: "ollama",
  model: "llama2",
  system: "You are a helpful assistant.",
  message: "Hello",
  host: "ollama.example.com",
  port: "11434",
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("handleOllama", () => {
  it("rejects localhost host", async () => {
    const res = await handleOllama({ ...validBody, host: "localhost" }, {});
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("SSRF_BLOCKED");
  });

  it("rejects 127.0.0.1 host", async () => {
    const res = await handleOllama({ ...validBody, host: "127.0.0.1" }, {});
    expect(res.status).toBe(403);
  });

  it("rejects blocked private IPs", async () => {
    const res = await handleOllama({ ...validBody, host: "10.0.0.1" }, {});
    expect(res.status).toBe(403);
  });

  it("allows public hosts", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: "Hello from Ollama!" } }],
        }),
    } as Response);

    const res = await handleOllama({ ...validBody, host: "ollama.example.com" }, {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content).toBe("Hello from Ollama!");
  });

  it("defaults host to 127.0.0.1 when not specified (but SSRF blocks it)", async () => {
    // The default host 127.0.0.1 is blocked by SSRF protection
    const res = await handleOllama({ ...validBody, host: undefined, port: undefined }, {});
    expect(res.status).toBe(403);
  });

  it("uses default port from OLLAMA_PORT env when port not specified", async () => {
    process.env.OLLAMA_PORT = "8080";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: "ok" } }],
        }),
    } as Response);
    vi.spyOn(globalThis, "fetch").mockImplementation(fetchMock);

    await handleOllama({ ...validBody, port: undefined }, {});
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe("http://ollama.example.com:8080/v1/chat/completions");
    delete process.env.OLLAMA_PORT;
  });

  it("uses default model llama2", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: "ok" } }],
        }),
    } as Response);
    vi.spyOn(globalThis, "fetch").mockImplementation(fetchMock);

    await handleOllama({ ...validBody, model: undefined, host: "ollama.example.com" }, {});
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sentBody.model).toBe("llama2");
  });

  it("returns error from upstream", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
      json: () =>
        Promise.resolve({
          error: "Model not found",
        }),
    } as Response);

    const res = await handleOllama(validBody, {});
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Model not found");
  });

  it("handles port as number", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: "ok" } }],
        }),
    } as Response);
    vi.spyOn(globalThis, "fetch").mockImplementation(fetchMock);

    await handleOllama({ ...validBody, host: "ollama.example.com", port: 11434 as unknown }, {});
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe("http://ollama.example.com:11434/v1/chat/completions");
  });
});

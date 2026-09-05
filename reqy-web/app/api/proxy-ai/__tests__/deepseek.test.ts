import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleDeepSeek } from "../handlers/deepseek";

const validBody = {
  provider: "deepseek",
  apiKey: ["sk", "-ds", "-test"].join(""),
  model: "deepseek-chat",
  system: "You are DeepSeek.",
  message: "Hello",
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("handleDeepSeek", () => {
  it("returns 400 if apiKey missing", async () => {
    const res = await handleDeepSeek({ ...validBody, apiKey: "" }, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Missing API key");
  });

  it("returns 400 if message missing", async () => {
    const res = await handleDeepSeek({ ...validBody, message: "" }, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Missing message");
  });

  it("returns upstream error on failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve(JSON.stringify({ error: { message: "Invalid API key" } })),
    } as Response);

    const res = await handleDeepSeek(validBody, {});
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain("Invalid API key");
  });

  it("returns content on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            choices: [{ message: { content: "Hello from DeepSeek!" } }],
          }),
        ),
    } as Response);

    const res = await handleDeepSeek(validBody, {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content).toBe("Hello from DeepSeek!");
  });

  it("returns tool_calls when present", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: "call_ds_1",
                      type: "function",
                      function: {
                        name: "search",
                        arguments: '{"query":"test"}',
                      },
                    },
                  ],
                },
              },
            ],
          }),
        ),
    } as Response);

    const res = await handleDeepSeek(validBody, {});
    const body = await res.json();
    expect(body.tool_calls).toHaveLength(1);
    expect(body.tool_calls[0].name).toBe("search");
    expect(body.provider_tool_format).toBe("openai");
  });

  it("stream passthrough when stream=true and no tools", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("data: hello\n\n"));
        controller.close();
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      body: stream,
    } as Response);

    const res = await handleDeepSeek({ ...validBody, stream: true }, {});
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
  });

  it("uses deepseek default model when not specified", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ choices: [{ message: { content: "ok" } }] })),
    } as Response);
    vi.spyOn(globalThis, "fetch").mockImplementation(fetchMock);

    await handleDeepSeek({ ...validBody, model: undefined }, {});
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sentBody.model).toBe("deepseek-chat");
  });

  it("uses correct API endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ choices: [{ message: { content: "ok" } }] })),
    } as Response);
    vi.spyOn(globalThis, "fetch").mockImplementation(fetchMock);

    await handleDeepSeek(validBody, {});
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.deepseek.com/chat/completions");
  });

  it("handles non-JSON error body gracefully", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 502,
      text: () => Promise.resolve("Bad Gateway"),
    } as Response);

    const res = await handleDeepSeek(validBody, {});
    const body = await res.json();
    expect(body.error).toBe("Bad Gateway");
  });
});

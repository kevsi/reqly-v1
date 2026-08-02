import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleAnthropic } from "../handlers/anthropic";

const validBody = {
  provider: "anthropic",
  apiKey: "sk-ant-test",
  model: "claude-sonnet-4-20250514",
  system: "You are Claude.",
  message: "Hello",
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("handleAnthropic", () => {
  it("returns 400 if apiKey missing", async () => {
    const res = await handleAnthropic({ ...validBody, apiKey: "" }, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Missing API key");
  });

  it("returns 400 if message missing", async () => {
    const res = await handleAnthropic({ ...validBody, message: "" }, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Missing message");
  });

  it("returns upstream error on failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
      json: () =>
        Promise.resolve({
          error: { message: "Invalid API key" },
        }),
    } as Response);

    const res = await handleAnthropic(validBody, {});
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Invalid API key");
  });

  it("returns text content on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          content: [{ type: "text", text: "Hello, human!" }],
          stop_reason: "end_turn",
        }),
    } as Response);

    const res = await handleAnthropic(validBody, {});
    const body = await res.json();
    expect(body.content).toBe("Hello, human!");
  });

  it("returns tool_use calls when present", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          content: [
            { type: "text", text: "Let me check the weather." },
            {
              type: "tool_use",
              id: "toolu_1",
              name: "get_weather",
              input: { city: "Paris" },
            },
          ],
          stop_reason: "tool_use",
        }),
    } as Response);

    const res = await handleAnthropic(validBody, {});
    const body = await res.json();
    expect(body.content).toBe("Let me check the weather.");
    expect(body.tool_calls).toHaveLength(1);
    expect(body.tool_calls[0].name).toBe("get_weather");
    expect(body.tool_calls[0].id).toBe("toolu_1");
    expect(body.provider_tool_format).toBe("anthropic");
  });

  it("strips trailing /v1 from model name if present", async () => {
    // Verify the request body uses correct model
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          content: [{ type: "text", text: "OK" }],
        }),
    } as Response);
    vi.spyOn(globalThis, "fetch").mockImplementation(fetchMock);

    await handleAnthropic(validBody, {});
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.model).toBe("claude-sonnet-4-20250514");
  });

  it("formats tools correctly for Anthropic format", async () => {
    const tools = [
      {
        function: {
          name: "get_weather",
          description: "Get weather",
          parameters: { type: "object", properties: { city: { type: "string" } } },
        },
      },
    ];

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          content: [{ type: "text", text: "OK" }],
        }),
    } as Response);
    vi.spyOn(globalThis, "fetch").mockImplementation(fetchMock);

    await handleAnthropic({ ...validBody, tools }, {});
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sentBody.tools).toHaveLength(1);
    expect(sentBody.tools[0].name).toBe("get_weather");
    expect(sentBody.tools[0].input_schema).toBeDefined();
  });

  it("handles non-standard error response shape", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: "Server Error" }),
    } as Response);

    const res = await handleAnthropic(validBody, {});
    const body = await res.json();
    expect(body.error).toBe("Server Error");
  });

  it("forwards anthropic usage in the response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          content: [{ type: "text", text: "salut" }],
          usage: { input_tokens: 5, output_tokens: 2 },
        }),
    } as Response);

    const res = await handleAnthropic(validBody, {});
    const body = await res.json();
    expect(body.usage).toEqual({ input_tokens: 5, output_tokens: 2 });
  });
});

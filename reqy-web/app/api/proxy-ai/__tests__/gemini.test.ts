import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleGemini } from "../handlers/gemini";

const validBody = {
  provider: "gemini",
  apiKey: "AIza-test",
  model: "gemini-2.0-flash",
  system: "You are Gemini.",
  message: "Hello",
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("handleGemini", () => {
  it("returns 400 if apiKey missing", async () => {
    const res = await handleGemini({ ...validBody, apiKey: "" }, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Missing API key");
  });

  it("returns 400 if message missing", async () => {
    const res = await handleGemini({ ...validBody, message: "" }, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Missing message");
  });

  it("returns content on success (non-streaming)", async () => {
    const responseData = {
      candidates: [
        {
          content: {
            parts: [{ text: "Hello from Gemini!" }],
          },
        },
      ],
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: () => Promise.resolve(responseData),
      text: () => Promise.resolve(JSON.stringify(responseData)),
    } as Response);

    const res = await handleGemini(validBody, {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content).toBe("Hello from Gemini!");
  });

  it("returns tool_calls when functionCall present", async () => {
    const responseData = {
      candidates: [
        {
          content: {
            parts: [{ text: "Calling function..." }],
          },
          functionCall: {
            name: "get_weather",
            args: { city: "Tokyo" },
            id: "fc_1",
          },
        },
      ],
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: () => Promise.resolve(responseData),
      text: () => Promise.resolve(JSON.stringify(responseData)),
    } as Response);

    const res = await handleGemini(validBody, {});
    const body = await res.json();
    expect(body.tool_calls).toHaveLength(1);
    expect(body.tool_calls[0].name).toBe("get_weather");
    expect(body.provider_tool_format).toBe("gemini");
  });

  it("returns blocked response when promptFeedback has blockReason", async () => {
    const responseData = {
      promptFeedback: { blockReason: "SAFETY" },
      candidates: [],
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: () => Promise.resolve(responseData),
      text: () => Promise.resolve(JSON.stringify(responseData)),
    } as Response);

    const res = await handleGemini(validBody, {});
    const body = await res.json();
    expect(body.blocked).toBe(true);
    expect(body.reason).toBe("SAFETY");
  });

  it("handles SSE streaming response with function calls", async () => {
    const events = [
      'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}\n\n',
      'data: {"candidates":[{"functionCall":{"name":"get_weather","args":{"city":"Paris"},"id":"fc_1"}}]}\n\n',
      "data: [DONE]\n\n",
    ];
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "text/event-stream" }),
      text: () => Promise.resolve(events.join("")),
    } as Response);

    const res = await handleGemini(validBody, {});
    const body = await res.json();
    expect(body.content).toBe("Hello");
    expect(body.tool_calls).toHaveLength(1);
    expect(body.tool_calls[0].name).toBe("get_weather");
  });

  it("returns upstream error on failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 403,
      headers: new Headers({ "content-type": "application/json" }),
      json: () =>
        Promise.resolve({
          error: { message: "API key not valid" },
        }),
      text: () => Promise.resolve(JSON.stringify({ error: { message: "API key not valid" } })),
    } as Response);

    const res = await handleGemini(validBody, {});
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("API key not valid");
  });

  it("formats tools correctly for Gemini", async () => {
    const tools = [
      {
        function: {
          name: "get_weather",
          description: "Get weather",
          parameters: { type: "object", properties: {} },
        },
      },
    ];

    const responseData = { candidates: [{ content: { parts: [{ text: "ok" }] } }] };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: () => Promise.resolve(responseData),
      text: () => Promise.resolve(JSON.stringify(responseData)),
    } as Response);
    vi.spyOn(globalThis, "fetch").mockImplementation(fetchMock);

    await handleGemini({ ...validBody, tools }, {});
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sentBody.tools).toHaveLength(1);
    expect(sentBody.tools[0].functionDeclarations).toBeDefined();
    expect(sentBody.tools[0].functionDeclarations[0].name).toBe("get_weather");
  });
});

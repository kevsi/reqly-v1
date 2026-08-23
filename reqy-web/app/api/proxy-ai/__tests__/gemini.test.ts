import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleGemini } from "../handlers/gemini";

const validBody = {
  provider: "gemini",
  apiKey: "AIza-test",
  model: "gemini-2.0-flash",
  system: "You are Gemini.",
  message: "Hello",
};

function mockJsonResponse(responseData: unknown, ok = true, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: () => Promise.resolve(responseData),
    text: () => Promise.resolve(JSON.stringify(responseData)),
  } as Response);
}

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
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 34 },
    };
    mockJsonResponse(responseData);

    const res = await handleGemini(validBody, {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content).toBe("Hello from Gemini!");
    expect(body.usage).toEqual({ input_tokens: 12, output_tokens: 34 });
  });

  it("concatenates all text parts of a multi-part response", async () => {
    const responseData = {
      candidates: [
        {
          content: {
            parts: [{ text: "Part one. " }, { text: "Part two." }],
          },
        },
      ],
    };
    mockJsonResponse(responseData);

    const res = await handleGemini(validBody, {});
    const body = await res.json();
    expect(body.content).toBe("Part one. Part two.");
  });

  it("returns tool_calls when functionCall parts present", async () => {
    const responseData = {
      candidates: [
        {
          content: {
            parts: [
              { text: "Calling function..." },
              { functionCall: { name: "get_weather", args: { city: "Tokyo" } } },
            ],
          },
        },
      ],
    };
    mockJsonResponse(responseData);

    const res = await handleGemini(validBody, {});
    const body = await res.json();
    expect(body.tool_calls).toHaveLength(1);
    expect(body.tool_calls[0].name).toBe("get_weather");
    expect(body.tool_calls[0].arguments).toBe(JSON.stringify({ city: "Tokyo" }));
    expect(body.provider_tool_format).toBe("gemini");
    expect(body.content).toBe("Calling function...");
  });

  it("collects multiple functionCalls from the same candidate", async () => {
    const responseData = {
      candidates: [
        {
          content: {
            parts: [
              { functionCall: { name: "get_weather", args: { city: "Tokyo" } } },
              { functionCall: { name: "get_time", args: { timezone: "JST" } } },
            ],
          },
        },
      ],
    };
    mockJsonResponse(responseData);

    const res = await handleGemini(validBody, {});
    const body = await res.json();
    expect(body.tool_calls).toHaveLength(2);
    expect(body.tool_calls[0].name).toBe("get_weather");
    expect(body.tool_calls[0].arguments).toBe(JSON.stringify({ city: "Tokyo" }));
    expect(body.tool_calls[1].name).toBe("get_time");
    expect(body.tool_calls[1].arguments).toBe(JSON.stringify({ timezone: "JST" }));
    expect(body.provider_tool_format).toBe("gemini");
  });

  it("returns blocked response when promptFeedback has blockReason", async () => {
    const responseData = {
      promptFeedback: { blockReason: "SAFETY" },
      candidates: [],
    };
    mockJsonResponse(responseData);

    const res = await handleGemini(validBody, {});
    const body = await res.json();
    expect(body.blocked).toBe(true);
    expect(body.reason).toBe("SAFETY");
  });

  it("uses :generateContent by default and parses a JSON response", async () => {
    const responseData = {
      candidates: [{ content: { parts: [{ text: "ok" }] } }],
    };
    const fetchMock = mockJsonResponse(responseData);

    await handleGemini(validBody, {});
    expect(fetchMock.mock.calls[0][0]).toContain(":generateContent");
    expect(fetchMock.mock.calls[0][0]).not.toContain("streamGenerateContent");
  });

  it("switches to streamGenerateContent?alt=sse when stream is requested", async () => {
    const events = ['data: {"candidates":[{"content":{"parts":[{"text":"Hi"}]}}]}\n\n'];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "text/event-stream" }),
      text: () => Promise.resolve(events.join("")),
    } as Response);

    const res = await handleGemini({ ...validBody, stream: true }, {});
    const body = await res.json();
    expect(fetchMock.mock.calls[0][0]).toContain(":streamGenerateContent?alt=sse");
    expect(body.content).toBe("Hi");
  });

  it("handles SSE streaming response with function calls and usage", async () => {
    const events = [
      'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}\n\n',
      'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"get_weather","args":{"city":"Paris"}}}]}}],"usageMetadata":{"promptTokenCount":7,"candidatesTokenCount":9}}\n\n',
      "data: [DONE]\n\n",
    ];
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "text/event-stream" }),
      text: () => Promise.resolve(events.join("")),
    } as Response);

    const res = await handleGemini({ ...validBody, stream: true }, {});
    const body = await res.json();
    expect(body.content).toBe("Hello");
    expect(body.tool_calls).toHaveLength(1);
    expect(body.tool_calls[0].name).toBe("get_weather");
    expect(body.provider_tool_format).toBe("gemini");
    expect(body.usage).toEqual({ input_tokens: 7, output_tokens: 9 });
  });

  it("returns upstream error on failure", async () => {
    const responseData = { error: { message: "API key not valid" } };
    mockJsonResponse(responseData, false, 403);

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
    const fetchMock = mockJsonResponse(responseData);

    await handleGemini({ ...validBody, tools }, {});
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sentBody.tools).toHaveLength(1);
    expect(sentBody.tools[0].functionDeclarations).toBeDefined();
    expect(sentBody.tools[0].functionDeclarations[0].name).toBe("get_weather");
  });
});

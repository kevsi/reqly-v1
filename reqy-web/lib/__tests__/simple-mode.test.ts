import { describe, it, expect, vi } from "vitest";
import {
  nlArgsToRequest,
  normalizeMethod,
  parseBuildRequestArgs,
  generateRequestFromNL,
  type BuildRequestArgs,
} from "@/lib/simple-mode/nl-to-request";

describe("normalizeMethod", () => {
  it("uppercases and accepts valid methods", () => {
    expect(normalizeMethod("post")).toBe("POST");
    expect(normalizeMethod("PUT")).toBe("PUT");
    expect(normalizeMethod("  delete ")).toBe("DELETE");
  });

  it("falls back to GET for unknown / empty methods", () => {
    expect(normalizeMethod("FOO")).toBe("GET");
    expect(normalizeMethod("")).toBe("GET");
    expect(normalizeMethod(undefined as unknown as string)).toBe("GET");
  });
});

describe("nlArgsToRequest", () => {
  it("maps a full build_request args object into a savable RequestItem", () => {
    const args: BuildRequestArgs = {
      method: "POST",
      url: "https://api.momo.cm/collect",
      headers: { Authorization: "Bearer x", "Content-Type": "application/json" },
      body: { amount: 1000, currency: "XAF" },
    };
    const req = nlArgsToRequest(args);
    expect(req.method).toBe("POST");
    expect(req.url).toBe("https://api.momo.cm/collect");
    expect(req.endpoint).toBe("/collect");
    expect(req.headers).toEqual({ Authorization: "Bearer x", "Content-Type": "application/json" });
    // object body is serialized to JSON and bodyType set to json
    expect(req.body).toBe(JSON.stringify({ amount: 1000, currency: "XAF" }));
    expect(req.bodyType).toBe("json");
    expect(req.name).toBe("POST https://api.momo.cm/collect");
    expect(req.queryParams).toEqual([]);
  });

  it("keeps string bodies as raw and defaults headers/body when absent", () => {
    const req = nlArgsToRequest({ method: "get", url: "https://example.com/ping" });
    expect(req.method).toBe("GET");
    expect(req.headers).toEqual({});
    expect(req.body).toBe("");
    expect(req.bodyType).toBeUndefined();
    expect(req.endpoint).toBe("/ping");
  });

  it("keeps a string body as raw and does not double-serialize", () => {
    const req = nlArgsToRequest({
      method: "POST",
      url: "https://example.com/x",
      body: "raw text payload",
    });
    expect(req.body).toBe("raw text payload");
    expect(req.bodyType).toBe("raw");
  });

  it("derives endpoint '/' when there is no path", () => {
    const req = nlArgsToRequest({ method: "GET", url: "https://example.com" });
    expect(req.endpoint).toBe("/");
  });
});

describe("parseBuildRequestArgs", () => {
  it("parses args wrapped in a build_request key", () => {
    const raw = JSON.stringify({
      build_request: { method: "put", url: "https://x/up", headers: { a: "1" } },
    });
    const args = parseBuildRequestArgs(raw);
    expect(args.method).toBe("put");
    expect(args.url).toBe("https://x/up");
    expect(args.headers).toEqual({ a: "1" });
  });

  it("parses args when the object is the args directly", () => {
    const raw = JSON.stringify({ method: "GET", url: "https://x/y" });
    const args = parseBuildRequestArgs(raw);
    expect(args.url).toBe("https://x/y");
    expect(args.method).toBe("GET");
  });

  it("tolerates JSON embedded in surrounding prose", () => {
    const raw = 'Voici : {"build_request":{"method":"post","url":"https://x/z"}}';
    const args = parseBuildRequestArgs(raw);
    expect(args.url).toBe("https://x/z");
    expect(args.method).toBe("post");
  });

  it("throws when no JSON could be parsed", () => {
    expect(() => parseBuildRequestArgs("totally not json")).toThrow();
  });

  it("throws when the URL is missing or empty", () => {
    expect(() => parseBuildRequestArgs(JSON.stringify({ method: "GET" }))).toThrow();
    expect(() =>
      parseBuildRequestArgs(JSON.stringify({ build_request: { method: "GET", url: "  " } })),
    ).toThrow();
  });
});

describe("generateRequestFromNL", () => {
  it("asks the AI engine and maps the result into a RequestItem", async () => {
    const askAI = vi.fn().mockResolvedValue(
      JSON.stringify({
        build_request: {
          method: "POST",
          url: "https://api.momo.cm/collect",
          headers: { "Content-Type": "application/json" },
          body: { amount: 1000 },
        },
      }),
    );
    const req = await generateRequestFromNL("envoie 1000 FCFA via MoMo", askAI);
    expect(askAI).toHaveBeenCalledTimes(1);
    expect(askAI.mock.calls[0][0]).toContain("build_request");
    expect(req.method).toBe("POST");
    expect(req.url).toBe("https://api.momo.cm/collect");
    expect(req.body).toBe(JSON.stringify({ amount: 1000 }));
  });

  it("propagates parse errors without calling the mapping helper", async () => {
    const askAI = vi.fn().mockResolvedValue("not json");
    await expect(generateRequestFromNL("x", askAI)).rejects.toThrow();
  });
});

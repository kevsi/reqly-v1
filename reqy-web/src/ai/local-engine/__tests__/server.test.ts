import { describe, it, expect } from "vitest";
import { serverRules } from "@/src/ai/local-engine/rules/server";
import type { RequestContext } from "@/src/ai/types";

const rule = (id: string) => serverRules.find((r) => r.id === id)!;
const ctxWithStatus = (status: number): RequestContext => ({ request: { method: "GET", url: "https://x", headers: {}, body: null, authType: "none" }, response: { status, statusText: "", headers: {}, body: {}, duration: 10, size: 0 }, timestamp: 0 });

describe("server.500", () => {
  it("matches 500", () => expect(rule("server.500").match(ctxWithStatus(500))).toBe(true));
});
describe("server.502/503/504", () => {
  it("502 matches", () => expect(rule("server.502").match(ctxWithStatus(502))).toBe(true));
  it("503 matches", () => expect(rule("server.503").match(ctxWithStatus(503))).toBe(true));
  it("504 matches", () => expect(rule("server.504").match(ctxWithStatus(504))).toBe(true));
});

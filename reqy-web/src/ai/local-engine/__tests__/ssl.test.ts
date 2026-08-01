import { describe, it, expect } from "vitest";
import { sslRules } from "@/src/ai/local-engine/rules/ssl";
import type { RequestContext } from "@/src/ai/types";

const rule = (id: string) => sslRules.find((r) => r.id === id)!;

describe("ssl.network.econnrefused", () => {
  it("matches ECONNREFUSED", () => {
    const ctx: RequestContext = { request: { method: "GET", url: "http://localhost:9999", headers: {}, body: null, authType: "none" }, error: { message: "connect ECONNREFUSED", code: "ECONNREFUSED", type: "network" }, timestamp: 0 };
    expect(rule("ssl.network.econnrefused").match(ctx)).toBe(true);
  });
});

describe("ssl.cert.expired", () => {
  it("matches CERT_HAS_EXPIRED", () => {
    const ctx: RequestContext = { request: { method: "GET", url: "https://expired.example", headers: {}, body: null, authType: "none" }, error: { message: "certificate has expired", code: "CERT_HAS_EXPIRED", type: "ssl" }, timestamp: 0 };
    expect(rule("ssl.cert.expired").match(ctx)).toBe(true);
  });
});

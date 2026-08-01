import { describe, it, expect } from "vitest";
import {
  decodeJwt,
  explainHeader,
  annotateJson,
  summarizeAnnotated,
} from "@/src/ai/cloud-engine/explain";

// A sample JWT (header.payload.signature) — payload has exp in the future
const FUTURE_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
  // payload: { "sub":"user1","exp":99999999999,"iat":1700000000 }
  "eyJzdWIiOiJ1c2VyMSIsImV4cCI6OTk5OTk5OTk5OTksImlhdCI6MTcwMDAwMDAwMH0." +
  "sig-placeholder";

// A JWT with exp in the past (year 2000)
const EXPIRED_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
  "eyJzdWIiOiJ1c2VyMSIsImV4cCI6OTQ2Njg0ODAwfQ." +
  "sig-placeholder";

describe("decodeJwt", () => {
  it("decodes a valid JWT", () => {
    const r = decodeJwt(FUTURE_JWT);
    expect(r).not.toBeNull();
    expect((r!.header as any).alg).toBe("HS256");
    expect((r!.payload as any).sub).toBe("user1");
    expect(r!.expired).toBe(false);
    expect(r!.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("detects expired token", () => {
    const r = decodeJwt(EXPIRED_JWT);
    expect(r!.expired).toBe(true);
  });

  it("returns null for malformed token", () => {
    expect(decodeJwt("not.a.jwt.atall.really")).toBeNull(); // 5 parts
    expect(decodeJwt("only.two")).toBeNull();
    expect(decodeJwt("invalid_base64!!!")).toBeNull();
  });

  it("returns null for non-string", () => {
    expect(decodeJwt(null as any)).toBeNull();
    expect(decodeJwt(undefined as any)).toBeNull();
  });
});

describe("explainHeader", () => {
  it("describes Authorization Bearer with JWT", () => {
    const r = explainHeader("Authorization", `Bearer ${FUTURE_JWT}`);
    expect(r.description).toContain("JWT");
  });

  it("warns on non-standard Authorization scheme", () => {
    const r = explainHeader("Authorization", "WeirdToken abc");
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("describes Content-Type", () => {
    const r = explainHeader("Content-Type", "application/json");
    expect(r.description).toContain("MIME");
  });

  it("warns on bad Content-Type", () => {
    const r = explainHeader("Content-Type", "not-a-mime");
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("describes unknown custom header", () => {
    const r = explainHeader("X-Custom", "foo");
    expect(r.description).toContain("Custom");
  });

  it("warns on long Cookie", () => {
    const r = explainHeader("Cookie", "x".repeat(5000));
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("warns on unknown X- prefix", () => {
    const r = explainHeader("X-Whatever", "x");
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe("annotateJson", () => {
  it("annotates primitives", () => {
    expect(annotateJson("hello")).toEqual({ type: "string", value: "hello" });
    expect(annotateJson(42)).toEqual({ type: "number", value: 42 });
    expect(annotateJson(true)).toEqual({ type: "boolean", value: true });
    expect(annotateJson(null)).toEqual({ type: "null", value: null });
  });

  it("annotates arrays", () => {
    const r = annotateJson([1, "two", false]);
    expect(r.type).toBe("array");
    expect(r.length).toBe(3);
    expect(r.items).toHaveLength(3);
    expect(r.items![0].type).toBe("number");
    expect(r.items![1].type).toBe("string");
    expect(r.items![2].type).toBe("boolean");
  });

  it("annotates nested objects", () => {
    const r = annotateJson({ user: { name: "Alice", age: 30 } });
    expect(r.type).toBe("object");
    expect(r.children!.user.type).toBe("object");
    expect(r.children!.user.children!.name.type).toBe("string");
    expect(r.children!.user.children!.age.value).toBe(30);
  });

  it("annotates empty object and array", () => {
    expect(annotateJson({}).children).toEqual({});
    expect(annotateJson([]).items).toEqual([]);
  });
});

describe("summarizeAnnotated", () => {
  it("summarizes object", () => {
    const s = summarizeAnnotated(annotateJson({ a: 1, b: "x" }));
    expect(s).toBe("object{a:number,b:string}");
  });

  it("summarizes array", () => {
    expect(summarizeAnnotated(annotateJson([1, 2, 3]))).toBe("array(3)");
  });

  it("summarizes primitive", () => {
    expect(summarizeAnnotated(annotateJson("hi"))).toBe("string");
  });
});

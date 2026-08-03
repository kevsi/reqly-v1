import { describe, it, expect } from "vitest";
import {
  transform,
  decodeJwt,
  verifyJwt,
  detect,
  uuidv4,
  randomHexBytes,
  randomBase64,
  utf8ByteLength,
  bytesToHex,
  jsonToCsv,
  csvToJson,
  htmlEncode,
  htmlDecode,
  regexEscape,
  sqlEscape,
} from "./codec";

describe("codec transform", () => {
  const sample = '{"nom":"Kévin","id":42}';

  it("round-trips base64 through UTF-8", () => {
    const enc = transform("b64-encode", sample);
    expect(enc.ok).toBe(true);
    if (!enc.ok) return;
    const dec = transform("b64-decode", enc.output);
    expect(dec).toEqual({ ok: true, output: sample });
  });

  it("round-trips URL encoding", () => {
    const enc = transform("url-encode", "a b&c=d?é");
    expect(enc.ok).toBe(true);
    if (!enc.ok) return;
    const dec = transform("url-decode", enc.output);
    expect(dec).toEqual({ ok: true, output: "a b&c=d?é" });
  });

  it("round-trips hex through UTF-8", () => {
    const enc = transform("hex-encode", "hello");
    expect(enc).toEqual({ ok: true, output: "68656c6c6f" });
    const dec = transform("hex-decode", "68656c6c6f");
    expect(dec).toEqual({ ok: true, output: "hello" });
  });

  it("formats and minifies JSON", () => {
    const formatted = transform("json-format", sample);
    expect(formatted.ok).toBe(true);
    if (formatted.ok) expect(formatted.output).toContain("\n  \"nom\"");

    const minified = transform("json-minify", formatted.ok ? formatted.output : sample);
    expect(minified).toEqual({ ok: true, output: sample });
  });

  it("returns a helpful error on invalid input", () => {
    const bad = transform("json-format", "{pas du json");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toBeTruthy();
  });
});

describe("jwt decode", () => {
  // header {"alg":"HS256","typ":"JWT"} + payload {"sub":"123","name":"John","iat":1516239022}
  const token =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMiLCJuYW1lIjoiSm9obiIsImlhdCI6MTUxNjIzOTAyMn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

  it("decodes header and payload", () => {
    const jwt = decodeJwt(token);
    expect(jwt.ok).toBe(true);
    expect(jwt.header).toMatchObject({ alg: "HS256", typ: "JWT" });
    expect(jwt.payload).toMatchObject({ sub: "123", name: "John" });
  });

  it("exposes exp when present", () => {
    const withExp = decodeJwt(
      "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjE3NTAwMDAwMDB9.x",
    );
    expect(withExp.ok).toBe(true);
    expect(withExp.exp).toBe(1750000000);
  });

  it("rejects malformed tokens", () => {
    expect(decodeJwt("not-a-jwt").ok).toBe(false);
    expect(decodeJwt("a.b").ok).toBe(false);
    expect(decodeJwt("###.@@@.%%%").ok).toBe(false);
  });
});

describe("generators + helpers", () => {
  it("uuidv4 returns a canonical v4 UUID", () => {
    const u = uuidv4();
    expect(u).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("randomHexBytes returns n bytes as hex", () => {
    expect(randomHexBytes(8)).toMatch(/^[0-9a-f]{16}$/);
  });

  it("randomBase64 decodes back to n bytes", () => {
    const b64 = randomBase64(16);
    const bin = atob(b64);
    expect(bin.length).toBe(16);
  });

  it("utf8ByteLength counts bytes not chars", () => {
    expect(utf8ByteLength("abc")).toBe(3);
    expect(utf8ByteLength("é")).toBe(2);
    expect(utf8ByteLength("🎉")).toBe(4);
  });

  it("bytesToHex round-trips with hexToBytes", () => {
    const bytes = new TextEncoder().encode("hello");
    expect(bytesToHex(bytes)).toBe("68656c6c6f");
  });
});

describe("escapes", () => {
  it("htmlEncode escapes all special chars and htmlDecode reverses it", () => {
    const enc = htmlEncode(`<div a="1" b='2'>x & y</div>`);
    expect(enc).toBe("&lt;div a=&quot;1&quot; b=&#39;2&#39;&gt;x &amp; y&lt;/div&gt;");
    expect(htmlDecode(enc)).toBe(`<div a="1" b='2'>x & y</div>`);
  });

  it("regexEscape escapes metacharacters", () => {
    expect(regexEscape("a.b*c")).toBe("a\\.b\\*c");
    expect(regexEscape("(x|y)")).toBe("\\(x\\|y\\)");
  });

  it("sqlEscape doubles single quotes", () => {
    expect(sqlEscape("O'Reilly")).toBe("O''Reilly");
  });
});

describe("csv", () => {
  it("jsonToCsv flattens an array of objects", () => {
    const csv = jsonToCsv('[{"id":1,"nom":"A"},{"id":2,"nom":"B"}]');
    expect(csv).toBe('id,nom\n1,A\n2,B');
  });

  it("jsonToCsv quotes cells with commas/quotes", () => {
    const csv = jsonToCsv('[{"v":"a,b"},{"v":"say \\"hi\\""}]');
    expect(csv).toBe('v\n"a,b"\n"say ""hi"""');
  });

  it("jsonToCsv rejects a non-array", () => {
    expect(() => jsonToCsv('{"a":1}')).toThrow();
  });

  it("csvToJson parses quoted cells and round-trips", () => {
    const input = 'id,nom\n1,"Doe, John"\n2,"X"\n';
    const json = csvToJson(input);
    const parsed = JSON.parse(json);
    expect(parsed).toEqual([
      { id: "1", nom: "Doe, John" },
      { id: "2", nom: "X" },
    ]);
  });
});

describe("auto-detection", () => {
  const token =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMiLCJuYW1lIjoiSm9obiIsImlhdCI6MTUxNjIzOTAyMn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

  it("detects JWT", () => {
    expect(detect(token)).toEqual({ kind: "jwt", mode: null });
  });

  it("detects JSON", () => {
    expect(detect('{"a":1}')).toMatchObject({ kind: "json", mode: "json-format" });
  });

  it("detects URL-encoded", () => {
    expect(detect("a%20b%26c")).toMatchObject({ kind: "url", mode: "url-decode" });
  });

  it("detects hex", () => {
    expect(detect("68656c6c6f")).toMatchObject({ kind: "hex", mode: "hex-decode" });
  });

  it("detects base64", () => {
    expect(detect("aGVsbG8=")).toMatchObject({ kind: "base64", mode: "b64-decode" });
  });

  it("treats plain text as plain", () => {
    expect(detect("hello world")).toEqual({ kind: "plain", mode: null });
  });
});

describe("jwt verification", () => {
  // header {alg:HS256} payload {sub:123,iat:1516239022} signed with secret "secret"
  const token =
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMiLCJpYXQiOjE1MTYyMzkwMjJ9.POfBjrRi19Qh0iSw0_6BQHyo8lZJFt15gjtRYs72Xfg";

  it("verifies a valid HS256 signature", async () => {
    const res = await verifyJwt(token, "secret");
    expect(res.valid).toBe(true);
    expect(res.alg).toBe("HS256");
  });

  it("rejects a wrong secret", async () => {
    const res = await verifyJwt(token, "wrong-secret");
    expect(res.valid).toBe(false);
  });

  it("rejects unsupported algorithms", async () => {
    const rs256 = await verifyJwt(
      "eyJhbGciOiJSUzI1NiJ9.eyJhIjoxfQ.x",
      "secret",
    );
    expect(rs256.valid).toBe(false);
    expect(rs256.error).toMatch(/non support/i);
  });
});

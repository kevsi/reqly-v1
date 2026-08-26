import { describe, it, expect } from "vitest";
import { buildRequestPayload } from "../request-executor";
import type { ExecuteRequestContext } from "../request-executor";
import type { RequestTab } from "@/lib/request-executor";

function makeContext(body: string): ExecuteRequestContext {
  const tab = {
    id: "t1",
    name: "test",
    method: "POST",
    url: "http://localhost:4600/form",
    endpoint: "",
    headers: [],
    queryParams: [],
    pathParams: [],
    body,
    bodyType: "form-data",
    authType: "none",
    authToken: "",
    hasResponse: false,
    isSaved: false,
  } as unknown as RequestTab;
  return {
    tab,
    allVars: [],
    activeProjectPort: 0,
    activeProject: false,
    nativeMode: false,
  };
}

describe("buildRequestPayload — body form-data (audit E1)", () => {
  it("décode les valeurs percent-encodées valides et pose le Content-Type multipart", () => {
    const { finalUrl, finalBody, headers } = buildRequestPayload(
      makeContext("name=hello%20world&city=Paris"),
    );

    expect(finalUrl).toContain("http://localhost:4600/form");
    expect(headers["Content-Type"]).toMatch(/^multipart\/form-data; boundary=----ReqlyFormBoundary/);
    expect(finalBody).toContain('name="name"\r\n\r\nhello world');
    expect(finalBody).toContain('name="city"\r\n\r\nParis');
    expect(finalBody.endsWith(`--${headers["Content-Type"].split("boundary=")[1]}--`)).toBe(true);
  });

  it("ne crashe PAS sur un percent malformé (ex: 100%) — valeur littérale conservée", () => {
    const { finalBody } = buildRequestPayload(makeContext("discount=100%&ok=1"));
    expect(finalBody).toContain('name="discount"\r\n\r\n100%');
    expect(finalBody).toContain('name="ok"\r\n\r\n1');
  });

  it("neutralise guillemets et retours à la ligne dans les CLÉS (header mono-ligne)", () => {
    const { finalBody } = buildRequestPayload(makeContext('we"ird\nkey=valeur'));
    expect(finalBody).toContain('name="weirdkey"');
    expect(finalBody).toContain("\r\nvaleur");
  });

  it("conserve les retours à la ligne DANS les valeurs (légal en multipart)", () => {
    const { finalBody } = buildRequestPayload(makeContext("texte=ligne1%0Aligne2"));
    expect(finalBody).toContain("ligne1\nligne2");
  });
});

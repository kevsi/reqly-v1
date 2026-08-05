import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parsePostmanCollection, parsePostmanEnvironment } from "./postman-import.js";
import { validateExportBundle } from "./validator.js";
import type { ExportBundle } from "./types.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures");

const FIXTURE = {
  info: {
    name: "My API",
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  },
  variable: [
    { key: "baseUrl", value: "https://api.example.com" },
    { key: "secret", value: "s3cr3t", disabled: true },
  ],
  auth: { type: "bearer", bearer: [{ key: "token", value: "collection-token" }] },
  event: [
    {
      listen: "prerequest",
      script: { exec: ["pm.request.headers.add({key: 'X-Trace', value: '1'})"] },
    },
  ],
  item: [
    {
      name: "Get users",
      request: {
        method: "GET",
        header: [{ key: "Accept", value: "application/json" }],
        url: {
          raw: "https://api.example.com/users?page=1",
          host: ["api", "example", "com"],
          path: ["users"],
          query: [{ key: "page", value: "1" }],
          protocol: "https",
        },
      },
    },
    {
      name: "Create user",
      request: {
        method: "POST",
        auth: { type: "bearer", bearer: [{ key: "token", value: "request-token" }] },
        header: [],
        url: { raw: "https://api.example.com/users" },
        body: {
          mode: "raw",
          raw: '{"name":"John"}',
          options: { raw: { language: "json" } },
        },
      },
      event: [
        {
          listen: "test",
          script: {
            exec: [
              'pm.test("created", () => pm.expect(pm.response.code).to.equal(201))',
              'pm.test("has id", () => pm.response.to.have.jsonBody("id"))',
            ],
          },
        },
      ],
    },
    {
      name: "Login",
      request: {
        method: "POST",
        url: { raw: "https://api.example.com/login" },
        body: {
          mode: "urlencoded",
          urlencoded: [
            { key: "username", value: "admin" },
            { key: "password", value: "hunter2", disabled: true },
          ],
        },
      },
    },
    {
      name: "GraphQL",
      request: {
        method: "POST",
        url: { raw: "https://api.example.com/graphql" },
        header: [{ key: "Content-Type", value: "application/json" }],
        body: {
          mode: "graphql",
          graphql: { query: "query { users { id } }", variables: '{"limit": 10}' },
        },
      },
    },
    {
      name: "Basic auth",
      request: {
        method: "GET",
        auth: {
          type: "basic",
          basic: [
            { key: "username", value: "user" },
            { key: "password", value: "pass" },
          ],
        },
        url: { raw: "https://api.example.com/secure" },
      },
    },
    {
      name: "Users folder",
      item: [
        {
          name: "List posts",
          request: { method: "GET", url: { raw: "https://api.example.com/posts" } },
        },
        {
          name: "Get one",
          request: { method: "GET", url: { raw: "https://api.example.com/posts/1" } },
        },
      ],
    },
  ],
};

describe("postman-import", () => {
  it("parses a v2.1 collection into an ExportBundle", () => {
    const bundle = parsePostmanCollection(JSON.stringify(FIXTURE));
    expect(bundle.version).toBe("1.0");
    expect(bundle.collections[0].name).toBe("My API");
    // 5 top-level requests + folder becomes a second collection with 2 requests.
    // Folder names are prefixed with their parent to stay unique when nesting.
    expect(bundle.collections[0].requests).toHaveLength(5);
    expect(bundle.collections[1].name).toBe("My API / Users folder");
    expect(bundle.collections[1].requests).toHaveLength(2);
  });

  it("maps collection variables to always-on bundle variables", () => {
    const bundle = parsePostmanCollection(JSON.stringify(FIXTURE));
    expect(bundle.variables).toEqual([
      { key: "baseUrl", value: "https://api.example.com", enabled: true },
      { key: "secret", value: "s3cr3t", enabled: false },
    ]);
  });

  it("converts URL, headers and raw JSON body", () => {
    const bundle = parsePostmanCollection(JSON.stringify(FIXTURE));
    const getUsers = bundle.collections[0].requests[0];
    expect(getUsers.name).toBe("Get users");
    expect(getUsers.method).toBe("GET");
    expect(getUsers.url).toBe("https://api.example.com/users?page=1");
    expect(getUsers.headers).toEqual({ Accept: "application/json" });

    const create = bundle.collections[0].requests[1];
    expect(create.method).toBe("POST");
    expect(create.body).toBe('{"name":"John"}');
    // No Content-Type header → raw body stays "raw" (JSON is only assumed when
    // the request declares a JSON content type).
    expect(create.bodyType).toBe("raw");
  });

  it("inherits collection auth unless the request overrides it", () => {
    const bundle = parsePostmanCollection(JSON.stringify(FIXTURE));
    expect(bundle.collections[0].requests[0].authType).toBe("bearer");
    expect(bundle.collections[0].requests[0].authToken).toBe("collection-token");
    expect(bundle.collections[0].requests[1].authToken).toBe("request-token");
  });

  it("converts basic auth to a base64 token", () => {
    const bundle = parsePostmanCollection(JSON.stringify(FIXTURE));
    const basic = bundle.collections[0].requests[4];
    expect(basic.authType).toBe("basic");
    expect(basic.authToken).toBe(Buffer.from("user:pass").toString("base64"));
  });

  it("turns events into scripts (pre joined, test joined)", () => {
    const bundle = parsePostmanCollection(JSON.stringify(FIXTURE));
    const create = bundle.collections[0].requests[1];
    // Collection-level prerequest is inherited by every request
    expect(bundle.collections[0].requests[0].scripts?.pre).toContain("X-Trace");
    expect(create.scripts?.post).toContain('pm.test("created"');
    expect(create.scripts?.post).toContain('pm.response.to.have.jsonBody("id")');
  });

  it("converts urlencoded bodies", () => {
    const bundle = parsePostmanCollection(JSON.stringify(FIXTURE));
    const login = bundle.collections[0].requests[2];
    expect(login.bodyType).toBe("x-www-form");
    expect(login.body).toBe("username=admin");
    expect(login.headers?.["Content-Type"]).toBe("application/x-www-form-urlencoded");
  });

  it("converts graphql requests to the GRAPHQL method with config", () => {
    const bundle = parsePostmanCollection(JSON.stringify(FIXTURE));
    const gql = bundle.collections[0].requests[3];
    expect(gql.method).toBe("GRAPHQL");
    expect(gql.graphql?.query).toContain("query { users");
    expect(gql.graphql?.variables).toBe('{"limit": 10}');
    expect(gql.bodyType).toBe("graphql");
  });

  it("adds import warnings for unsupported constructs", () => {
    const withFile = {
      ...FIXTURE,
      item: [
        ...FIXTURE.item,
        {
          name: "Upload",
          request: {
            method: "POST",
            url: { raw: "https://api.example.com/upload" },
            body: {
              mode: "formdata",
              formdata: [{ key: "file", type: "file", src: "/tmp/x.txt" }],
            },
          },
        },
      ],
    };
    const bundle = parsePostmanCollection(JSON.stringify(withFile)) as ExportBundle & {
      importWarnings?: string[];
    };
    expect(bundle.importWarnings?.some((w) => w.includes("file upload"))).toBe(true);
  });

  it("rejects non-collection JSON", () => {
    expect(() => parsePostmanCollection('{"foo": 1}')).toThrow(/missing top-level "item"/);
    expect(() => parsePostmanCollection('{"item": []}')).toThrow(/missing "info.name"/);
    expect(() => parsePostmanCollection("not json")).toThrow(/Invalid Postman collection JSON/);
  });

  it("produces a bundle that passes the validator", () => {
    const bundle = parsePostmanCollection(JSON.stringify(FIXTURE));
    expect(validateExportBundle(bundle)).toEqual([]);
  });

  describe("real Xero OAuth 2.0 collection", () => {
    // The real-world fixture (Xero's official OAuth2 collection) exercises the
    // legacy postman.* API, pm.sendRequest token dances, empty OAuth2 tokens,
    // formdata bodies and header variables — the edge cases that matter.
    const fixture = fs.readFileSync(path.join(FIXTURES, "xero.postman_collection.json"), "utf8");
    const bundle = parsePostmanCollection(fixture) as ExportBundle & { importWarnings?: string[] };

    it("imports all 4 requests with scripts preserved", () => {
      expect(bundle.collections).toHaveLength(1);
      expect(bundle.collections[0].name).toBe("Xero OAuth 2.0");
      expect(bundle.collections[0].requests).toHaveLength(4);
      const byName = Object.fromEntries(bundle.collections[0].requests.map((r) => [r.name, r]));
      // Invoices: the OAuth2 refresh_token flow lives in the pre-request script.
      expect(byName["Invoices"].scripts?.pre).toContain("pm.sendRequest");
      expect(byName["Invoices"].scripts?.pre).toContain("formdata");
      // Get started / Connections: legacy v1 test scripts (postman.* + tests[]).
      expect(byName["Get started"].scripts?.post).toContain("postman.setEnvironmentVariable");
      expect(byName["Refresh token"].scripts?.post).toContain("tests[");
      // No import warnings for this real collection.
      expect(bundle.importWarnings ?? []).toEqual([]);
    });

    it("drops the empty OAuth2 accessToken and keeps header variables", () => {
      const byName = Object.fromEntries(bundle.collections[0].requests.map((r) => [r.name, r]));
      expect(byName["Get started"].authType).toBeUndefined();
      expect(byName["Connections"].headers?.Authorization).toBe("Bearer {{access_token}}");
      expect(byName["Invoices"].headers?.["xero-tenant-id"]).toBe("{{xero-tenant-id}}");
    });

    it("converts the token refresh to a urlencoded form body", () => {
      const byName = Object.fromEntries(bundle.collections[0].requests.map((r) => [r.name, r]));
      const refresh = byName["Refresh token"];
      expect(refresh.bodyType).toBe("x-www-form");
      expect(refresh.body).toContain("grant_type=refresh_token");
      // Values are urlencoded at import; {{vars}} are interpolated at run time.
      expect(refresh.body).toContain("refresh_token=%7B%7Brefresh_token%7D%7D");
      // Postman exported an empty query entry — preserved faithfully.
      expect(refresh.queryParams).toEqual([{ key: "", value: "", enabled: true }]);
    });
  });

  describe("parsePostmanEnvironment", () => {
    it("converts a .postman_environment.json into an Environment", () => {
      const env = parsePostmanEnvironment(
        JSON.stringify({
          name: "OAuth 2.0",
          values: [
            { key: "client_id", value: "cid", enabled: true },
            { key: "client_secret", value: "", enabled: false },
          ],
        }),
      );
      expect(env.name).toBe("OAuth 2.0");
      expect(env.variables).toEqual([
        { key: "client_id", value: "cid", enabled: true },
        { key: "client_secret", value: "", enabled: false },
      ]);
    });

    it("rejects invalid JSON", () => {
      expect(() => parsePostmanEnvironment("nope")).toThrow(/Invalid Postman environment JSON/);
    });
  });
});

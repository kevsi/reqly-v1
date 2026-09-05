import { describe, it, expect } from "vitest";
import { load as loadYaml } from "js-yaml";
import { buildBrunoFiles, slugify, requestToBru } from "../bruno-export";
import { buildOpenCollectionFiles, emitYaml } from "../opencollection-export";
import { buildCollectionFiles } from "../export-collection";
import type { Collection, RequestItem } from "@/lib/types";

function request(overrides: Partial<RequestItem> = {}): RequestItem {
  return {
    id: "r1",
    name: "Get User",
    method: "GET",
    url: "https://api.example.com/users/1",
    endpoint: "/users/1",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function collection(overrides: Partial<Collection> = {}): Collection {
  return {
    id: "c1",
    name: "My Collection",
    color: "#000",
    icon: "box",
    requests: [],
    folders: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("slugify", () => {
  it("slugs names and strips accents", () => {
    expect(slugify("Create User!")).toBe("create-user");
    expect(slugify("Créer éû")).toBe("creer-eu");
    expect(slugify("///")).toBe("untitled");
  });
});

describe("buildBrunoFiles", () => {
  it("produces bruno.json and one .bru per request", () => {
    const files = buildBrunoFiles(
      collection({ requests: [request(), request({ id: "r2", name: "Create User", method: "POST", body: '{"a":1}', bodyType: "json" })] }),
    );
    expect(files.has("bruno.json")).toBe(true);
    expect(files.get("bruno.json")).toContain('"name": "My Collection"');
    expect(files.has("get-user.bru")).toBe(true);
    expect(files.has("create-user.bru")).toBe(true);

    const bru = files.get("get-user.bru")!;
    expect(bru).toContain("meta {");
    expect(bru).toContain("type: http");
    expect(bru).toContain("get {");
    expect(bru).toContain("url: https://api.example.com/users/1");
  });

  it("emits headers, query params, body and auth blocks", () => {
    const bru = requestToBru(
      request({
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer x" },
        queryParams: [{ key: "page", value: "2" }],
        body: '{"name":"John"}',
        bodyType: "json",
        authType: "bearer",
        authToken: "tok",
        runnerAssertions: [
          { type: "status", expected: 201 },
          { type: "jsonPath", path: "user.name", operator: "equals", value: "John" },
        ],
      }),
      1,
    );
    expect(bru).toContain("headers {");
    expect(bru).toContain("  Content-Type: application/json");
    expect(bru).toContain("params:query {");
    expect(bru).toContain("  page: 2");
    expect(bru).toContain("body:json {");
    expect(bru).toContain('"name":"John"');
    expect(bru).toContain("auth {");
    expect(bru).toContain("  mode: bearer");
    expect(bru).toContain("tests {");
    expect(bru).toContain("expect(res.getStatus()).to.equal(201)");
    expect(bru).toContain('expect(res.getBody()).to.nested.property("user.name"');
  });

  it("decodes basic auth into username/password", () => {
    // base64("user:pass") = dXNlcjpwYXNz
    const bru = requestToBru(
      request({ authType: "basic", authToken: "dXNlcjpwYXNz" }),
      1,
    );
    expect(bru).toContain("  mode: basic");
    expect(bru).toContain("  username: user");
    expect(bru).toContain("  password: pass");
  });

  it("nests requests into folders and materializes empty folders", () => {
    const files = buildBrunoFiles(
      collection({
        folders: [
          { id: "f1", name: "Users", parentId: null, collectionId: "c1", order: 0, createdAt: 1, updatedAt: 1 },
          { id: "f2", name: "Admin", parentId: "f1", collectionId: "c1", order: 1, createdAt: 1, updatedAt: 1 },
          { id: "f3", name: "Empty", parentId: null, collectionId: "c1", order: 2, createdAt: 1, updatedAt: 1 },
        ],
        requests: [request({ folderId: "f2" })],
      }),
    );
    expect(files.has("users/admin/get-user.bru")).toBe(true);
    expect(files.has("empty/folder.bru")).toBe(true);
  });
});

describe("buildOpenCollectionFiles", () => {
  it("produces opencollection.yml and request files", () => {
    const files = buildOpenCollectionFiles(
      collection({
        requests: [
          request({
            method: "POST",
            url: "https://api.example.com/users",
            body: '{\n  "name": "John"\n}',
            bodyType: "json",
            authType: "bearer",
            authToken: "tok",
          }),
        ],
      }),
    );
    expect(files.has("opencollection.yml")).toBe(true);
    expect(files.get("opencollection.yml")).toContain('type: "collection"');

    const yml = files.get("get-user.yml")!;
    expect(yml).toContain("info:");
    expect(yml).toContain('  name: "Get User"');
    expect(yml).toContain('  type: "http"');
    expect(yml).toContain("http:");
    expect(yml).toContain('  method: "POST"');
    expect(yml).toContain("  body:");
    expect(yml).toContain('    type: "json"');
    expect(yml).toContain("    data: |-");
    expect(yml).toContain("  auth:");
    expect(yml).toContain("    bearer:");
  });

  it("emits test scripts into runtime.scripts", () => {
    const files = buildOpenCollectionFiles(
      collection({
        requests: [request({ runnerAssertions: [{ type: "status", expected: 200 }] })],
      }),
    );
    const yml = files.get("get-user.yml")!;
    expect(yml).toContain("runtime:");
    expect(yml).toContain('- type: "tests"');
    expect(yml).toContain("expect(res.getStatus()).to.equal(200)");
  });
});

describe("emitYaml", () => {
  it("emits nested maps, arrays and multiline literals", () => {
    const yaml = emitYaml({
      info: { name: "Col", seq: 1 },
      http: {
        headers: [{ key: "A", value: "b" }],
        body: { data: "line1\nline2" },
      },
    });
    expect(yaml).toContain('info:\n  name: "Col"\n  seq: 1');
    expect(yaml).toContain("- key: \"A\"");
    expect(yaml).toContain("data: |-\n      line1\n      line2");
  });

  it("round-trips every emitted OpenCollection file through js-yaml", () => {
    const files = buildOpenCollectionFiles(
      collection({
        description: "Une collection de test",
        folders: [
          { id: "f1", name: "Users", parentId: null, collectionId: "c1", order: 0, createdAt: 1, updatedAt: 1 },
        ],
        requests: [
          request({
            name: "Create User",
            method: "POST",
            url: "https://api.example.com/users",
            headers: { "Content-Type": "application/json" },
            queryParams: [{ key: "dryRun", value: "1" }],
            body: '{\n  "name": "John"\n}',
            bodyType: "json",
            authType: "bearer",
            authToken: "tok",
            preRequestScript: "console.log('pre');",
            runnerAssertions: [
              { type: "status", expected: 201 },
              { type: "jsonPath", path: "ok", operator: "equals", value: true },
            ],
            folderId: "f1",
          }),
          request({ id: "r2", name: "Get User" }),
        ],
      }),
    );
    expect(files.size).toBeGreaterThanOrEqual(3);
    for (const [path, content] of files) {
      const parsed = loadYaml(content) as Record<string, unknown>;
      expect(parsed).toBeTypeOf("object");
      expect(Object.keys(parsed).length).toBeGreaterThan(0);
      // La séquence info/http doit être préservée dans chaque requête.
      if (path !== "opencollection.yml" && !path.endsWith("folder.yml")) {
        expect(parsed.info).toBeTypeOf("object");
        expect(parsed.http).toBeTypeOf("object");
      }
    }
    // Le contenu multiligne du body doit être identique après parsing.
    const post = loadYaml(files.get("users/create-user.yml")!) as {
      http: { body: { data: string } };
    };
    expect(post.http.body.data).toBe('{\n  "name": "John"\n}');
  });
});

describe("buildCollectionFiles", () => {
  it("dispatches to the right format writer", () => {
    const col = collection({ requests: [request()] });
    expect(buildCollectionFiles(col, "bruno").has("bruno.json")).toBe(true);
    expect(buildCollectionFiles(col, "opencollection").has("opencollection.yml")).toBe(true);
  });
});

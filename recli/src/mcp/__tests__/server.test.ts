import { describe, it, expect, beforeEach } from "vitest";
import { CollectionStore } from "../store.js";
import { listTools } from "../tool-definitions.js";
import { createToolHandler } from "../tools.js";
import type { ExportBundle } from "../types.js";

function makeSampleBundle(): ExportBundle {
  return {
    version: "1.0",
    exportedAt: new Date().toISOString(),
    collections: [
      {
        id: "col-1",
        name: "Test Collection",
        description: "A test",
        color: "blue",
        icon: "folder",
        requests: [
          {
            id: "req-1",
            name: "Get Users",
            method: "GET",
            url: "https://jsonplaceholder.typicode.com/users",
            endpoint: "https://jsonplaceholder.typicode.com/users",
            headers: {} as Record<string, string>,
            queryParams: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ],
        folders: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ],
    environments: [],
  };
}

function getTextContent(result: { content: Array<{ type: string; text?: string }> }): string {
  const item = result.content[0];
  if (item && "text" in item) return item.text ?? "";
  return "";
}

describe("CollectionStore", () => {
  let store: CollectionStore;

  beforeEach(() => {
    store = new CollectionStore();
  });

  it("starts empty", () => {
    expect(store.getCollections()).toHaveLength(0);
  });

  it("loads from bundle", () => {
    store.loadFromBundle(makeSampleBundle());
    expect(store.getCollections()).toHaveLength(1);
    expect(store.getCollections()[0].name).toBe("Test Collection");
  });

  it("creates a collection", () => {
    const col = store.addCollection("New Col", undefined, "emerald");
    expect(col.id).toBeTruthy();
    expect(store.getCollections()).toHaveLength(1);
    expect(store.getCollection(col.id)?.name).toBe("New Col");
  });

  it("finds request by ID", () => {
    store.loadFromBundle(makeSampleBundle());
    const found = store.findRequestById("req-1");
    expect(found).toBeTruthy();
    expect(found!.request.name).toBe("Get Users");
    expect(found!.collection.id).toBe("col-1");
  });

  it("returns undefined for unknown request ID", () => {
    expect(store.findRequestById("nonexistent")).toBeUndefined();
  });

  it("assigns ids + MCP invariants to a name-based bundle on load", () => {
    // A recli-authored bundle (demo.json style) has no ids, no endpoint, no
    // timestamps — the bridge must fill all of them so MCP tools work.
    const nameOnly = {
      version: "1.0",
      collections: [
        {
          name: "Demo",
          requests: [{ name: "List posts", method: "GET", url: "https://example.com/posts" }],
        },
      ],
      environments: [{ name: "prod", variables: [] }],
    } as unknown as ExportBundle;
    store.loadFromBundle(nameOnly);
    const col = store.getCollections()[0];
    expect(col.id).toMatch(/^col-/);
    expect(col.createdAt).toBeGreaterThan(0);
    const req = col.requests[0];
    expect(req.id).toMatch(/^req-/);
    expect(req.endpoint).toBe("https://example.com/posts");
    expect(req.createdAt).toBeGreaterThan(0);
    expect(store.getEnvironments()[0].id).toMatch(/^env-/);
    // All three are now addressable by their generated ids.
    expect(store.findRequestById(req.id)?.request.name).toBe("List posts");
  });

  it("preserves existing ids on load", () => {
    store.loadFromBundle(makeSampleBundle());
    expect(store.getCollections()[0].id).toBe("col-1");
    expect(store.findRequestById("req-1")).toBeTruthy();
  });

  it("finds a request by name (case-insensitive) as a fallback", () => {
    store.loadFromBundle(makeSampleBundle());
    const found = store.findRequestById("GET USERS");
    expect(found?.request.name).toBe("Get Users");
  });

  it("does not fall back to a name that matches multiple requests", () => {
    // A mutating tool (delete/update) must never silently hit the wrong request
    // when a name is duplicated across collections.
    const dupes = {
      version: "1.0",
      collections: [
        {
          id: "col-a",
          name: "A",
          requests: [{ id: "r1", name: "Shared name", method: "GET", url: "https://a.example" }],
        },
        {
          id: "col-b",
          name: "B",
          requests: [{ id: "r2", name: "Shared name", method: "GET", url: "https://b.example" }],
        },
      ],
    } as unknown as ExportBundle;
    store.loadFromBundle(dupes);
    expect(store.findRequestById("Shared name")).toBeUndefined();
    // Exact ids still resolve.
    expect(store.findRequestById("r1")?.request.url).toBe("https://a.example");
  });

  it("prefers an exact id match over a same-looking name", () => {
    const mixed = {
      version: "1.0",
      collections: [
        {
          id: "col-x",
          name: "C",
          requests: [
            { id: "hello", name: "unrelated", method: "GET", url: "https://a.example" },
            { id: "world", name: "HELLO", method: "GET", url: "https://b.example" },
          ],
        },
      ],
    } as unknown as ExportBundle;
    store.loadFromBundle(mixed);
    const byId = store.findRequestById("hello");
    expect(byId?.request.url).toBe("https://a.example");
    const byName = store.findRequestById("HELLO");
    expect(byName?.request.url).toBe("https://b.example");
  });

  it("serializes and deserializes", () => {
    store.loadFromBundle(makeSampleBundle());
    const bundle = store.serializeBundle();
    expect(bundle).toBeTruthy();
    expect(bundle.collections).toHaveLength(1);

    const store2 = new CollectionStore();
    store2.loadFromBundle(bundle);
    expect(store2.getCollections()).toHaveLength(1);
  });

  it("deletes a collection", () => {
    store.loadFromBundle(makeSampleBundle());
    store.deleteCollection("col-1");
    expect(store.getCollections()).toHaveLength(0);
  });

  it("adds a request inside a collection", () => {
    store.loadFromBundle(makeSampleBundle());
    const now = Date.now();
    store.addRequest("col-1", {
      id: "req-new",
      name: "New",
      method: "POST",
      url: "https://example.com",
      endpoint: "https://example.com",
      headers: {} as Record<string, string>,
      queryParams: [],
      createdAt: now,
      updatedAt: now,
    });
    const col = store.getCollection("col-1");
    expect(col!.requests).toHaveLength(2);
  });

  it("duplicates a collection", () => {
    store.loadFromBundle(makeSampleBundle());
    const cloned = store.duplicateCollection("col-1");
    expect(cloned.id).not.toBe("col-1");
    expect(cloned.name).toBe("Test Collection (copy)");
    expect(store.getCollections()).toHaveLength(2);
  });

  it("deletes a request", () => {
    store.loadFromBundle(makeSampleBundle());
    store.deleteRequest("req-1");
    const col = store.getCollection("col-1");
    expect(col!.requests).toHaveLength(0);
  });

  it("duplicates a request", () => {
    store.loadFromBundle(makeSampleBundle());
    const cloned = store.duplicateRequest("req-1", "col-1");
    expect(cloned.id).not.toBe("req-1");
    const col = store.getCollection("col-1");
    expect(col!.requests).toHaveLength(2);
  });

  it("updates a collection", () => {
    store.loadFromBundle(makeSampleBundle());
    store.updateCollection("col-1", { name: "Updated" });
    expect(store.getCollection("col-1")?.name).toBe("Updated");
  });

  it("updates a request", () => {
    store.loadFromBundle(makeSampleBundle());
    store.updateRequest("req-1", { name: "Updated Req" });
    expect(store.findRequestById("req-1")!.request.name).toBe("Updated Req");
  });

  it("moves a request between collections", () => {
    store.loadFromBundle(makeSampleBundle());
    const col2 = store.addCollection("Col 2");
    store.moveRequest("req-1", col2.id);
    const col1 = store.getCollection("col-1");
    const col2b = store.getCollection(col2.id);
    expect(col1!.requests).toHaveLength(0);
    expect(col2b!.requests).toHaveLength(1);
  });

  it("adds environments", () => {
    const env = store.addEnvironment("prod", "green");
    expect(env.id).toBeTruthy();
    expect(store.getEnvironments()).toHaveLength(1);
    expect(store.getEnvironment("prod")?.name).toBe("prod");
  });

  it("resolves variables from environment", () => {
    const env = store.addEnvironment("staging");
    store.updateEnvironment(env.id!, {
      variables: [
        { key: "host", value: "staging.example.com", enabled: true },
        { key: "disabled_key", value: "should_not_appear", enabled: false },
      ],
    });
    const vars = store.getResolvedVariables("staging");
    expect(vars).toEqual({ host: "staging.example.com" });
  });

  it("searches requests by name", () => {
    store.loadFromBundle(makeSampleBundle());
    const results = store.searchRequests("Users");
    expect(results).toHaveLength(1);
    expect(results[0].request.name).toBe("Get Users");
  });

  it("searches requests by URL", () => {
    store.loadFromBundle(makeSampleBundle());
    const results = store.searchRequests("jsonplaceholder");
    expect(results).toHaveLength(1);
  });

  it("searches requests with no match", () => {
    store.loadFromBundle(makeSampleBundle());
    const results = store.searchRequests("xxxnonexistentxxx");
    expect(results).toHaveLength(0);
  });

  it("manages folders", () => {
    store.loadFromBundle(makeSampleBundle());
    const folder = store.addFolder("col-1", "Auth");
    expect(folder.name).toBe("Auth");
    expect(store.getCollection("col-1")!.folders).toHaveLength(1);

    store.updateFolder(folder.id, { name: "Authentication" });
    const updated = store.getCollection("col-1")!.folders![0];
    expect(updated!.name).toBe("Authentication");

    store.deleteFolder(folder.id);
    expect(store.getCollection("col-1")!.folders).toHaveLength(0);
  });
});

describe("ToolDefinitions", () => {
  it("lists tools with all required fields", () => {
    const tools = listTools();
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.inputSchema).toBeTruthy();
    }
  });

  it("includes collection management tools", () => {
    const tools = listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("create_collection");
    expect(names).toContain("list_collections");
    expect(names).toContain("create_request");
    expect(names).toContain("run_request");
    expect(names).toContain("run_collection");
  });
});

describe("ToolHandler", () => {
  let store: CollectionStore;
  let handler: ReturnType<typeof createToolHandler>;

  beforeEach(() => {
    store = new CollectionStore();
    store.loadFromBundle(makeSampleBundle());
    handler = createToolHandler(store, undefined, {
      defaultTimeoutMs: 5000,
      defaultEnvName: undefined,
      allowLocalHosts: true,
      maxResponseSize: 1024 * 1024,
    });
  });

  it("handles list_collections", async () => {
    const result = await handler("list_collections", {});
    expect(result.content).toHaveLength(1);
    const text = getTextContent(result);
    expect(text).toContain("Test Collection");
  });

  it("handles get_collection_tree", async () => {
    const result = await handler("get_collection_tree", { collection_id: "col-1" });
    expect(result.content).toHaveLength(1);
    const text = getTextContent(result);
    expect(text).toContain("Get Users");
  });

  it("handles create_collection", async () => {
    const result = await handler("create_collection", { name: "New Col 2" });
    expect(result.content).toHaveLength(1);
    const text = getTextContent(result);
    expect(text).toContain("New Col 2");
    expect(store.getCollections()).toHaveLength(2);
  });

  it("handles delete_collection", async () => {
    await handler("delete_collection", { collection_id: "col-1" });
    expect(store.getCollections()).toHaveLength(0);
  });

  it("handles duplicate_collection", async () => {
    const result = await handler("duplicate_collection", { collection_id: "col-1" });
    expect(result.content).toHaveLength(1);
    expect(store.getCollections()).toHaveLength(2);
    expect(store.getCollections()[1].name).toContain("copy");
  });

  it("handles create_request", async () => {
    const result = await handler("create_request", {
      collection_id: "col-1",
      name: "New Req",
      method: "POST",
      url: "https://example.com",
    });
    expect(result.content).toHaveLength(1);
    const col = store.getCollection("col-1");
    expect(col!.requests).toHaveLength(2);
  });

  it("handles delete_request", async () => {
    await handler("delete_request", { request_id: "req-1" });
    const col = store.getCollection("col-1");
    expect(col!.requests).toHaveLength(0);
  });

  it("handles duplicate_request", async () => {
    await handler("duplicate_request", { request_id: "req-1" });
    const col = store.getCollection("col-1");
    expect(col!.requests).toHaveLength(2);
  });

  it("handles update_request", async () => {
    await handler("update_request", {
      request_id: "req-1",
      name: "Renamed",
      method: "POST",
    });
    const found = store.findRequestById("req-1");
    expect(found!.request.name).toBe("Renamed");
  });

  it("handles search_requests", async () => {
    const result = await handler("search_requests", { query: "Users" });
    const text = getTextContent(result);
    expect(text).toContain("Get Users");
  });

  it("handles create_environment", async () => {
    const result = await handler("create_environment", { name: "Test Env" });
    expect(result.content).toHaveLength(1);
    expect(store.getEnvironments()).toHaveLength(1);
  });

  it("handles list_environments", async () => {
    store.addEnvironment("prod");
    const result = await handler("list_environments", {});
    expect(result.content).toHaveLength(1);
    const text = getTextContent(result);
    expect(text).toContain("prod");
  });

  it("handles get_environment_variables", async () => {
    const env = store.addEnvironment("test");
    store.updateEnvironment(env.id!, {
      variables: [{ key: "api_url", value: "https://api.test.com", enabled: true }],
    });
    const result = await handler("get_environment_variables", { env_name: "test" });
    expect(result.content).toHaveLength(1);
    const text = getTextContent(result);
    expect(text).toContain("api_url");
  });

  it("handles resolve_variables", async () => {
    const env = store.addEnvironment("staging");
    store.updateEnvironment(env.id!, {
      variables: [{ key: "host", value: "staging.example.com", enabled: true }],
    });
    const result = await handler("resolve_variables", {
      text: "https://{{host}}/api",
      env_name: "staging",
    });
    expect(result.content).toHaveLength(1);
    const text = getTextContent(result);
    expect(text).toContain("staging.example.com");
  });

  it("handles validate_request", async () => {
    const result = await handler("validate_request", { request_id: "req-1" });
    expect(result.content).toHaveLength(1);
  });

  it("returns error for unknown tool", async () => {
    const result = await handler("unknown_tool", {});
    expect(result.isError).toBe(true);
    expect(getTextContent(result)).toContain("Unknown tool");
  });

  it("handles create_folder", async () => {
    const result = await handler("create_folder", {
      collection_id: "col-1",
      name: "Auth",
    });
    expect(result.content).toHaveLength(1);
    const text = getTextContent(result);
    expect(text).toContain("Auth");
    expect(store.getCollection("col-1")!.folders).toHaveLength(1);
  });

  it("handles export_bundle with data", async () => {
    const result = await handler("export_bundle", {});
    expect(result.content).toHaveLength(1);
    const text = getTextContent(result);
    expect(text).toContain("Test Collection");
  });

  it("handles export_to_openapi", async () => {
    const result = await handler("export_to_openapi", {});
    expect(result.content).toHaveLength(1);
    const text = getTextContent(result);
    expect(text).toContain("openapi");
  });

  it("handles export_request_to_curl", async () => {
    const result = await handler("export_request_to_curl", { request_id: "req-1" });
    expect(result.content).toHaveLength(1);
    const text = getTextContent(result);
    expect(text).toContain("curl");
  });
});

describe("ToolHandler — Run Request", () => {
  const timeout = 30000;

  it(
    "runs a real HTTP request against jsonplaceholder",
    async () => {
      const store = new CollectionStore();
      store.loadFromBundle(makeSampleBundle());
      const handler = createToolHandler(store, undefined, {
        defaultTimeoutMs: 10000,
        defaultEnvName: undefined,
        allowLocalHosts: false,
        maxResponseSize: 1024 * 1024,
      });

      const result = await handler("run_request", { request_id: "req-1" });
      expect(result.content).toHaveLength(1);
      const text = getTextContent(result);
      expect(text).toContain("200");
    },
    timeout,
  );

  it("returns error for missing request", async () => {
    const store = new CollectionStore();
    const handler = createToolHandler(store, undefined, {
      defaultTimeoutMs: 5000,
      defaultEnvName: undefined,
      allowLocalHosts: false,
      maxResponseSize: 1024 * 1024,
    });

    const result = await handler("run_request", { request_id: "nonexistent" });
    expect(result.isError).toBe(true);
  });

  it("returns error for unknown collection in run_collection", async () => {
    const store = new CollectionStore();
    const handler = createToolHandler(store, undefined, {
      defaultTimeoutMs: 5000,
      defaultEnvName: undefined,
      allowLocalHosts: false,
      maxResponseSize: 1024 * 1024,
    });

    const result = await handler("run_collection", { collection_id: "nonexistent" });
    expect(result.isError).toBe(true);
  });
});

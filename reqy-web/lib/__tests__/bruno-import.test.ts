import { describe, it, expect } from "vitest";
import { parseBrunoCollection, convertBrunoToCollections } from "@/lib/bruno-import";

const BRU_SINGLE_REQUEST = `meta {
  name: Get Users
  type: http
  seq: 1
}

get {
  url: https://api.example.com/users
  body: none
  auth: none
}

headers {
  accept: application/json
  authorization: Bearer {{token}}
}`;

const BRU_WITH_BODY = `meta {
  name: Create User
  type: http
  seq: 2
}

post {
  url: {{baseUrl}}/api/users
  body: json
  auth: bearer
}

headers {
  content-type: application/json
}

body:json {
  {
    "name": "John",
    "email": "john@example.com"
  }
}`;

const BRU_EMPTY = `meta {
  name: Empty Request
  type: http
}`;

const JSON_BUNDLE = {
  name: "My Bruno Collection",
  items: [
    {
      method: "GET",
      url: "https://api.example.com/users",
      name: "Get Users",
      headers: { accept: "application/json" },
    },
    {
      method: "POST",
      url: "https://api.example.com/users",
      name: "Create User",
      body: JSON.stringify({ name: "John" }),
    },
  ],
};

const JSON_BUNDLE_WITH_REQUEST_WRAPPER = {
  name: "Collection from Export",
  requests: [
    {
      name: "Get Items",
      request: {
        method: "GET",
        url: "https://api.example.com/items",
        headers: [{ key: "Accept", value: "application/json" }],
      },
    },
  ],
};

const INVALID_CONTENT = "not a valid format @@@";

describe("parseBrunoCollection", () => {
  describe(".bru DSL format", () => {
    it("parses a basic GET request", () => {
      const result = parseBrunoCollection(BRU_SINGLE_REQUEST, "get-users.bru");
      assertSuccess(result);
      expect(result.collectionName).toBe("Get Users");
      expect(result.endpoints).toHaveLength(1);
      expect(result.endpoints[0].method).toBe("GET");
      expect(result.endpoints[0].url).toBe("https://api.example.com/users");
    });

    it("extracts headers from .bru format", () => {
      const result = parseBrunoCollection(BRU_SINGLE_REQUEST);
      assertSuccess(result);
      expect(result.endpoints[0].headers).toBeDefined();
      expect(result.endpoints[0].headers!.accept).toBe("application/json");
      expect(result.endpoints[0].headers!.authorization).toBe("Bearer {{token}}");
    });

    it("parses a POST request with JSON body", () => {
      const result = parseBrunoCollection(BRU_WITH_BODY, "create-user.bru");
      assertSuccess(result);
      expect(result.endpoints[0].method).toBe("POST");
      expect(result.endpoints[0].url).toBe("{{baseUrl}}/api/users");
      expect(result.endpoints[0].body).toBeDefined();
      expect(result.endpoints[0].body).toContain("John");
      expect(result.endpoints[0].bodyType).toBe("json");
    });

    it("rejects .bru without an HTTP method block", () => {
      const result = parseBrunoCollection(BRU_EMPTY);
      expect(result.success).toBe(false);
    });
  });

  describe("JSON bundle format", () => {
    it("parses a Bruno JSON bundle", () => {
      const result = parseBrunoCollection(JSON.stringify(JSON_BUNDLE));
      assertSuccess(result);
      expect(result.collectionName).toBe("My Bruno Collection");
      expect(result.endpoints).toHaveLength(2);
      expect(result.endpoints[0].method).toBe("GET");
      expect(result.endpoints[1].method).toBe("POST");
    });

    it("parses bundles with request wrapper objects", () => {
      const result = parseBrunoCollection(JSON.stringify(JSON_BUNDLE_WITH_REQUEST_WRAPPER));
      assertSuccess(result);
      expect(result.endpoints).toHaveLength(1);
      expect(result.endpoints[0].method).toBe("GET");
      expect(result.endpoints[0].url).toBe("https://api.example.com/items");
    });
  });

  describe("error handling", () => {
    it("returns error for invalid content", () => {
      const result = parseBrunoCollection(INVALID_CONTENT);
      expect(result.success).toBe(false);
    });
  });
});

describe("convertBrunoToCollections", () => {
  it("converts parse result to CollectionImportData", () => {
    const parseResult = parseBrunoCollection(JSON.stringify(JSON_BUNDLE));
    assertSuccess(parseResult);

    const collections = convertBrunoToCollections(parseResult);
    expect(collections).toHaveLength(1);
    expect(collections[0].name).toBe("My Bruno Collection");
    expect(collections[0].requests).toHaveLength(2);
  });

  it("preserves headers and body in conversion", () => {
    const parseResult = parseBrunoCollection(BRU_WITH_BODY);
    assertSuccess(parseResult);

    const collections = convertBrunoToCollections(parseResult);
    expect(collections[0].requests[0].headers).toBeDefined();
    expect(collections[0].requests[0].body).toContain("John");
    expect(collections[0].requests[0].bodyType).toBe("json");
  });
});

function assertSuccess(
  result: ReturnType<typeof parseBrunoCollection>,
): asserts result is { success: true; collectionName: string; endpoints: unknown[] } {
  if (!result.success) {
    throw new Error(`Expected success, got error: ${result.error}`);
  }
}

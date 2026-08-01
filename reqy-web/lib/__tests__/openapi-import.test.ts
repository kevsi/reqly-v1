import { describe, it, expect } from "vitest";
import {
  parseOpenApiSpec,
  convertToCollections,
  mergeImportedCollections,
} from "@/lib/openapi-import";

// ─── Test specs ──────────────────────────────────────────────────────────────

const SWAGGER_2_SPEC = {
  swagger: "2.0",
  info: { title: "Pet Store", version: "1.0.0", description: "A pet store API" },
  host: "petstore.example.com",
  basePath: "/v2",
  schemes: ["https"],
  consumes: ["application/json"],
  produces: ["application/json"],
  securityDefinitions: {
    bearerAuth: { type: "apiKey", name: "Authorization", in: "header" },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    "/pets": {
      get: {
        summary: "List all pets",
        tags: ["Pets"],
        parameters: [
          {
            name: "limit",
            in: "query",
            required: false,
            type: "integer",
            description: "Max results",
          },
        ],
        responses: {
          "200": { description: "A list of pets" },
        },
      },
      post: {
        summary: "Create a pet",
        tags: ["Pets"],
        parameters: [
          {
            name: "body",
            in: "body",
            required: true,
            schema: {
              type: "object",
              required: ["name"],
              properties: {
                name: { type: "string", example: "Buddy" },
                species: { type: "string", enum: ["cat", "dog", "fish"] },
                age: { type: "integer", format: "int32" },
              },
            },
          },
        ],
        responses: {
          "201": { description: "Created" },
        },
      },
    },
    "/pets/{petId}": {
      get: {
        summary: "Get pet by ID",
        tags: ["Pets"],
        parameters: [{ name: "petId", in: "path", required: true, type: "string" }],
        responses: {
          "200": { description: "A pet" },
        },
      },
      delete: {
        summary: "Delete a pet",
        tags: ["Pets"],
        parameters: [{ name: "petId", in: "path", required: true, type: "string" }],
        responses: {
          "204": { description: "Deleted" },
        },
      },
    },
  },
  definitions: {
    CreatePet: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string", example: "Buddy" },
        species: { type: "string", enum: ["cat", "dog", "fish"] },
        age: { type: "integer", format: "int32" },
      },
    },
  },
};

const OPENAPI_3_0_SPEC = {
  openapi: "3.0.3",
  info: { title: "User API", version: "2.0.0" },
  servers: [{ url: "https://api.example.com/v2" }],
  paths: {
    "/users": {
      get: {
        summary: "Get all users",
        tags: ["Users"],
        parameters: [{ name: "page", in: "query", schema: { type: "integer" } }],
        responses: {
          "200": { description: "User list" },
        },
      },
      post: {
        summary: "Create user",
        tags: ["Users"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/CreateUser",
              },
            },
          },
        },
        responses: {
          "201": { description: "Created" },
        },
      },
    },
    "/users/{id}": {
      get: {
        summary: "Get user by ID",
        tags: ["Users"],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "User detail" },
        },
      },
    },
  },
  components: {
    schemas: {
      CreateUser: {
        type: "object",
        required: ["email"],
        properties: {
          email: { type: "string", format: "email", example: "user@example.com" },
          name: { type: "string", example: "John" },
          role: { type: "string", enum: ["admin", "user"] },
        },
      },
    },
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer" },
    },
  },
  security: [{ bearerAuth: [] }],
};

const OPENAPI_3_1_SPEC = {
  openapi: "3.1.0",
  info: { title: "Config API", version: "1.0.0" },
  servers: [{ url: "https://config.example.com" }],
  jsonSchemaDialect: "https://spec.openapis.org/oas/3.1/dialect/base",
  paths: {
    "/config": {
      get: {
        summary: "Get config",
        tags: ["Config"],
        responses: {
          "200": { description: "Configuration" },
        },
      },
    },
  },
  components: {
    schemas: {},
  },
};

const SPEC_WITHOUT_PATHS = {
  openapi: "3.0.3",
  info: { title: "Empty API", version: "1.0.0" },
};

const INVALID_CONTENT = "this is not json or yaml {{{broken}}";

const YAML_SPEC = `
openapi: "3.0.3"
info:
  title: YAML API
  version: "1.0.0"
paths:
  /items:
    get:
      summary: List items
      tags: [Items]
      responses:
        "200":
          description: OK
`;

const SPEC_WITH_CIRCULAR_REF: Record<string, unknown> = {
  openapi: "3.0.3",
  info: { title: "Circular", version: "1.0.0" },
  paths: {
    "/loop": {
      get: {
        summary: "Self-referencing",
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Node" },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Node: {
        type: "object",
        properties: {
          name: { type: "string" },
          child: { $ref: "#/components/schemas/Node" },
        },
      },
    },
  },
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("parseOpenApiSpec", () => {
  describe("Swagger 2.0", () => {
    it("parses a swagger 2.0 spec correctly", () => {
      const result = parseOpenApiSpec(JSON.stringify(SWAGGER_2_SPEC));
      assertSuccess(result);
      expect(result.spec.title).toBe("Pet Store");
      expect(result.spec.version).toBe("1.0.0");
      expect(result.spec.description).toBe("A pet store API");
      expect(result.spec.baseUrl).toBe("https://petstore.example.com/v2");
      expect(result.totalEndpoints).toBe(4);
      expect(result.tagGroups).toHaveLength(1);
      expect(result.tagGroups[0].tag).toBe("Pets");
    });

    it("maps root security to all endpoints", () => {
      const result = parseOpenApiSpec(JSON.stringify(SWAGGER_2_SPEC));
      assertSuccess(result);
      for (const ep of result.endpoints) {
        expect(ep.security).toBeDefined();
        expect(ep.security.length).toBeGreaterThanOrEqual(1);
      }
    });

    it("generates body example from definition schema", () => {
      const result = parseOpenApiSpec(JSON.stringify(SWAGGER_2_SPEC));
      assertSuccess(result);
      const createPet = result.endpoints.find((e) => e.method === "POST" && e.path === "/pets");
      expect(createPet).toBeDefined();
      expect(createPet!.requestBody).toBeDefined();
      expect(createPet!.requestBody!.example).toContain("Buddy");
      expect(createPet!.requestBody!.contentType).toBe("application/json");
    });
  });

  describe("OpenAPI 3.0", () => {
    it("parses an OpenAPI 3.0 spec correctly", () => {
      const result = parseOpenApiSpec(JSON.stringify(OPENAPI_3_0_SPEC));
      assertSuccess(result);
      expect(result.spec.title).toBe("User API");
      expect(result.spec.version).toBe("2.0.0");
      expect(result.spec.baseUrl).toBe("https://api.example.com/v2");
      expect(result.totalEndpoints).toBe(3);
      expect(result.tagGroups).toHaveLength(1);
      expect(result.tagGroups[0].tag).toBe("Users");
    });

    it("resolves $ref in requestBody schemas", () => {
      const result = parseOpenApiSpec(JSON.stringify(OPENAPI_3_0_SPEC));
      assertSuccess(result);
      const createUser = result.endpoints.find((e) => e.method === "POST" && e.path === "/users");
      expect(createUser).toBeDefined();
      expect(createUser!.requestBody).toBeDefined();
      expect(createUser!.requestBody!.example).toContain("user@example.com");
      expect(createUser!.requestBody!.example).toContain("John");
    });

    it("extracts path-level parameters", () => {
      const result = parseOpenApiSpec(JSON.stringify(OPENAPI_3_0_SPEC));
      assertSuccess(result);
      const getUser = result.endpoints.find((e) => e.method === "GET" && e.path === "/users/{id}");
      expect(getUser).toBeDefined();
      const pathParam = getUser!.parameters.find((p) => p.name === "id");
      expect(pathParam).toBeDefined();
      expect(pathParam!.in).toBe("path");
      expect(pathParam!.required).toBe(true);
    });

    it("maps security schemes", () => {
      const result = parseOpenApiSpec(JSON.stringify(OPENAPI_3_0_SPEC));
      assertSuccess(result);
      expect(result.spec.securitySchemes).toBeDefined();
      expect(result.spec.securitySchemes!.bearerAuth).toBeDefined();
    });
  });

  describe("OpenAPI 3.1", () => {
    it("parses an OpenAPI 3.1 spec correctly", () => {
      const result = parseOpenApiSpec(JSON.stringify(OPENAPI_3_1_SPEC));
      assertSuccess(result);
      expect(result.spec.title).toBe("Config API");
      expect(result.spec.version).toBe("1.0.0");
      expect(result.spec.baseUrl).toBe("https://config.example.com");
      expect(result.totalEndpoints).toBe(1);
    });
  });

  describe("YAML format", () => {
    it("parses a YAML spec correctly", () => {
      const result = parseOpenApiSpec(YAML_SPEC, "spec.yaml");
      assertSuccess(result);
      expect(result.spec.title).toBe("YAML API");
      expect(result.totalEndpoints).toBe(1);
    });
  });

  describe("error handling", () => {
    it("returns an error for invalid JSON/YAML", () => {
      const result = parseOpenApiSpec(INVALID_CONTENT, "bad.json");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeTruthy();
      }
    });

    it("returns an error for unrecognized spec format", () => {
      const result = parseOpenApiSpec(JSON.stringify({ random: "object" }));
      expect(result.success).toBe(false);
    });

    it("handles specs with no paths gracefully", () => {
      const result = parseOpenApiSpec(JSON.stringify(SPEC_WITHOUT_PATHS));
      assertSuccess(result);
      expect(result.totalEndpoints).toBe(0);
      expect(result.endpoints).toHaveLength(0);
      expect(result.tagGroups).toHaveLength(0);
    });
  });

  describe("$ref resolution", () => {
    it("does not loop infinitely on circular $ref", () => {
      const result = parseOpenApiSpec(JSON.stringify(SPEC_WITH_CIRCULAR_REF));
      assertSuccess(result);
      expect(result.totalEndpoints).toBe(1);
    });
  });

  describe("grouping", () => {
    it("groups endpoints by tag", () => {
      const multiTagSpec = {
        openapi: "3.0.3",
        info: { title: "Multi", version: "1.0.0" },
        paths: {
          "/a": { get: { tags: ["Alpha"], responses: { "200": { description: "OK" } } } },
          "/b": { get: { tags: ["Beta"], responses: { "200": { description: "OK" } } } },
          "/c": { get: { tags: ["Alpha"], responses: { "200": { description: "OK" } } } },
        },
      };
      const result = parseOpenApiSpec(JSON.stringify(multiTagSpec));
      assertSuccess(result);
      expect(result.tagGroups).toHaveLength(2);
      const alpha = result.tagGroups.find((g) => g.tag === "Alpha");
      expect(alpha).toBeDefined();
      expect(alpha!.endpoints).toHaveLength(2);
    });

    it("falls back to 'General' when no tags are present", () => {
      const noTagSpec = {
        openapi: "3.0.3",
        info: { title: "No Tags", version: "1.0.0" },
        paths: {
          "/x": { get: { responses: { "200": { description: "OK" } } } },
        },
      };
      const result = parseOpenApiSpec(JSON.stringify(noTagSpec));
      assertSuccess(result);
      expect(result.tagGroups).toHaveLength(1);
      expect(result.tagGroups[0].tag).toBe("General");
    });
  });
});

// ─── convertToCollections ────────────────────────────────────────────────────

describe("convertToCollections", () => {
  it("creates one collection per tag when groupByTag is true", () => {
    const parseResult = parseOpenApiSpec(JSON.stringify(OPENAPI_3_0_SPEC));
    assertSuccess(parseResult);

    const collections = convertToCollections(parseResult, {
      groupByTag: true,
    });
    expect(collections).toHaveLength(1);
    expect(collections[0].name).toBe("Users");
    expect(collections[0].requests).toHaveLength(3);
  });

  it("creates a single collection when groupByTag is false", () => {
    const parseResult = parseOpenApiSpec(JSON.stringify(OPENAPI_3_0_SPEC));
    assertSuccess(parseResult);

    const collections = convertToCollections(parseResult, {
      groupByTag: false,
      collectionName: "My Collection",
    });
    expect(collections).toHaveLength(1);
    expect(collections[0].name).toBe("My Collection");
    expect(collections[0].requests).toHaveLength(3);
  });

  it("applies baseUrlOverride when provided", () => {
    const spec = { ...OPENAPI_3_0_SPEC, servers: [{ url: "https://old.example.com" }] };
    const parseResult = parseOpenApiSpec(JSON.stringify(spec));
    assertSuccess(parseResult);

    const collections = convertToCollections(parseResult, {
      groupByTag: false,
      baseUrlOverride: "https://override.example.com",
    });
    for (const req of collections[0].requests) {
      expect(req.url).toContain("override.example.com");
    }
  });

  it("maps auth type from security scheme", () => {
    // The OpenAPI 3.0 spec has bearerAuth → expect authType "bearer"
    const parseResult = parseOpenApiSpec(JSON.stringify(OPENAPI_3_0_SPEC));
    assertSuccess(parseResult);

    // With root security and securitySchemes, endpointToRequest maps to bearer
    const collections = convertToCollections(parseResult, { groupByTag: false });
    for (const req of collections[0].requests) {
      // authType should be set to "bearer" from the bearerAuth security scheme
      expect(req.authType).toBe("bearer");
    }
  });

  it("converts query parameters", () => {
    const parseResult = parseOpenApiSpec(JSON.stringify(OPENAPI_3_0_SPEC));
    assertSuccess(parseResult);

    const collections = convertToCollections(parseResult, { groupByTag: true });
    const getUsers = collections[0].requests.find((r) => r.name.includes("Get all users"));
    expect(getUsers).toBeDefined();
    expect(getUsers!.queryParams).toBeDefined();
    expect(getUsers!.queryParams).toContainEqual(
      expect.objectContaining({ key: "page", value: "" }),
    );
  });

  it("converts swagger 2.0 body parameters to requests with body", () => {
    const parseResult = parseOpenApiSpec(JSON.stringify(SWAGGER_2_SPEC));
    assertSuccess(parseResult);

    const collections = convertToCollections(parseResult, { groupByTag: true });
    const createPet = collections[0].requests.find((r) => r.name.includes("Create a pet"));
    expect(createPet).toBeDefined();
    expect(createPet!.body).toBeTruthy();
    expect(createPet!.body).toContain("Buddy");
    expect(createPet!.bodyType).toBe("json");
  });
});

// ─── mergeImportedCollections ────────────────────────────────────────────────

describe("mergeImportedCollections", () => {
  it("adds new collections", () => {
    const result = mergeImportedCollections({
      local: [],
      imported: [{ id: "c1", name: "New", updatedAt: 100 }],
    });
    expect(result.toUpsert).toHaveLength(1);
    expect(result.summary.added).toBe(1);
  });

  it("updates when imported is newer", () => {
    const result = mergeImportedCollections({
      local: [{ id: "c1", name: "Old", updatedAt: 50 }],
      imported: [{ id: "c1", name: "New", updatedAt: 100 }],
    });
    expect(result.toUpsert).toHaveLength(1);
    expect(result.summary.updated).toBe(1);
  });

  it("skips when local is newer", () => {
    const result = mergeImportedCollections({
      local: [{ id: "c1", name: "Local", updatedAt: 200 }],
      imported: [{ id: "c1", name: "Imported", updatedAt: 100 }],
    });
    expect(result.toUpsert).toHaveLength(0);
    expect(result.summary.skipped).toBe(1);
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function assertSuccess(
  result: ReturnType<typeof parseOpenApiSpec>,
): asserts result is {
  success: true;
  spec: any;
  endpoints: any[];
  tagGroups: any[];
  totalEndpoints: number;
} {
  if (!result.success) {
    throw new Error(`Expected success, got error: ${result.error}`);
  }
}

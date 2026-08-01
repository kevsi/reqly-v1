import { describe, it, expect } from "vitest";
import { importOpenAPI, exportToOpenApi } from "../index.js";

const petstoreJson = JSON.stringify({
  openapi: "3.0.0",
  info: { title: "Petstore", version: "1.0.0" },
  servers: [{ url: "https://petstore.example.com/api" }],
  paths: {
    "/pets": {
      get: {
        operationId: "listPets",
        summary: "List all pets",
        parameters: [{ name: "limit", in: "query", schema: { type: "integer" }, example: 10 }],
        responses: { "200": { description: "OK" } },
      },
      post: {
        operationId: "createPet",
        summary: "Create a pet",
        requestBody: {
          content: {
            "application/json": {
              example: { name: "Buddy", species: "dog" },
            },
          },
        },
        responses: { "201": { description: "Created" } },
      },
    },
    "/pets/{petId}": {
      get: {
        operationId: "getPet",
        summary: "Get a pet by ID",
        parameters: [{ name: "petId", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "OK" } },
      },
    },
  },
});

describe("importOpenAPI", () => {
  it("importe une spec JSON valide", () => {
    const bundle = importOpenAPI(petstoreJson);
    expect(bundle.collections).toHaveLength(1);
    expect(bundle.collections[0].name).toBe("Petstore");
  });

  it("extrait le bon nombre de requêtes", () => {
    const bundle = importOpenAPI(petstoreJson);
    expect(bundle.collections[0].requests).toHaveLength(3);
  });

  it("parse les méthodes HTTP", () => {
    const bundle = importOpenAPI(petstoreJson);
    const methods = bundle.collections[0].requests.map((r) => r.method);
    expect(methods).toContain("GET");
    expect(methods).toContain("POST");
  });

  it("extrait les query params", () => {
    const bundle = importOpenAPI(petstoreJson);
    const listPets = bundle.collections[0].requests.find((r) => r.name === "listPets");
    expect(listPets?.queryParams).toHaveLength(1);
    expect(listPets?.queryParams![0].key).toBe("limit");
  });

  it("extrait le body example", () => {
    const bundle = importOpenAPI(petstoreJson);
    const createPet = bundle.collections[0].requests.find((r) => r.name === "createPet");
    expect(createPet?.body).toBeTruthy();
    expect(createPet?.body).toContain("Buddy");
  });

  it("resolve les paramètres path", () => {
    const bundle = importOpenAPI(petstoreJson);
    const getPet = bundle.collections[0].requests.find((r) => r.name === "getPet");
    // getPet a {petId} dans le path mais pas d'exemple → devient :petId
    expect(getPet?.url).toContain(":petId");
  });

  it("rejette une spec invalide", () => {
    expect(() => importOpenAPI('{"invalid": true}')).toThrow();
  });

  it("rejette du texte non-JSON/non-YAML", () => {
    expect(() => importOpenAPI("not-json")).toThrow();
  });
});

describe("exportToOpenApi", () => {
  it("exporte des collections en spec OpenAPI JSON", () => {
    const spec = exportToOpenApi([
      {
        id: "c1",
        name: "Test API",
        requests: [
          {
            id: "r1",
            name: "Get users",
            method: "GET",
            url: "https://api.example.com/users",
            endpoint: "/users",
            headers: undefined,
            queryParams: [],
            body: undefined,
            bodyType: undefined,
            authType: undefined,
            authToken: undefined,
            sortOrder: 0,
          },
        ],
      },
    ]);
    expect(spec).toContain("openapi");
    expect(spec).toContain("3.0.0");
    expect(spec).toContain("Test API");
    expect(spec).toContain("/users");
  });

  it("génère une spec JSON valide", () => {
    const spec = exportToOpenApi([]);
    const parsed = JSON.parse(spec);
    expect(parsed.openapi).toBe("3.0.0");
    expect(parsed.paths).toEqual({});
  });
});

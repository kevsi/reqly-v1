import { describe, it, expect } from "vitest"
import { importOpenAPI } from "./openapi.js"

const petstoreJson = JSON.stringify({
  openapi: "3.0.3",
  info: {
    title: "Pet Store API",
    version: "1.0.0",
    description: "A sample pet store API",
  },
  servers: [{ url: "https://petstore.example.com/api/v1" }],
  paths: {
    "/pets": {
      get: {
        operationId: "listPets",
        summary: "List all pets",
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer" }, example: 10 },
          { name: "page", in: "query", schema: { type: "integer" }, example: 1 },
        ],
        responses: { "200": { description: "OK" } },
      },
      post: {
        operationId: "createPet",
        summary: "Create a pet",
        requestBody: {
          content: {
            "application/json": {
              example: { name: "Buddy", species: "dog", age: 3 },
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
        parameters: [
          { name: "petId", in: "path", required: true, schema: { type: "integer" }, example: 42 },
        ],
        responses: { "200": { description: "OK" } },
      },
      delete: {
        operationId: "deletePet",
        summary: "Delete a pet",
        parameters: [
          { name: "petId", in: "path", required: true, schema: { type: "integer" }, example: 42 },
        ],
        responses: { "204": { description: "No content" } },
      },
    },
  },
})

describe("openapi", () => {
  describe("importOpenAPI", () => {
    it("imports a valid OpenAPI 3.0 spec", () => {
      const bundle = importOpenAPI(petstoreJson)
      expect(bundle.version).toBe("1.0")
      expect(bundle.collections).toHaveLength(1)
      expect(bundle.collections[0].name).toBe("Pet Store API")
    })

    it("creates one request per endpoint + method", () => {
      const bundle = importOpenAPI(petstoreJson)
      expect(bundle.collections[0].requests).toHaveLength(4)
    })

    it("uses operationId as request name", () => {
      const bundle = importOpenAPI(petstoreJson)
      const names = bundle.collections[0].requests.map((r) => r.name)
      expect(names).toContain("listPets")
      expect(names).toContain("createPet")
      expect(names).toContain("getPet")
      expect(names).toContain("deletePet")
    })

    it("sets correct HTTP methods", () => {
      const bundle = importOpenAPI(petstoreJson)
      const methods = bundle.collections[0].requests.map((r) => r.method)
      expect(methods).toContain("GET")
      expect(methods).toContain("POST")
      expect(methods).toContain("DELETE")
    })

    it("builds correct URLs with base server", () => {
      const bundle = importOpenAPI(petstoreJson)
      const getPet = bundle.collections[0].requests.find((r) => r.name === "getPet")
      expect(getPet).toBeDefined()
      expect(getPet!.url).toBe("https://petstore.example.com/api/v1/pets/42")
    })

    it("includes query parameters", () => {
      const bundle = importOpenAPI(petstoreJson)
      const listPets = bundle.collections[0].requests.find((r) => r.name === "listPets")
      expect(listPets).toBeDefined()
      expect(listPets!.queryParams).toHaveLength(2)
      expect(listPets!.queryParams![0].key).toBe("limit")
    })

    it("includes request body example for POST", () => {
      const bundle = importOpenAPI(petstoreJson)
      const createPet = bundle.collections[0].requests.find((r) => r.name === "createPet")
      expect(createPet).toBeDefined()
      expect(createPet!.body).toContain("Buddy")
      expect(createPet!.bodyType).toBe("json")
    })

    it("includes description from summary", () => {
      const bundle = importOpenAPI(petstoreJson)
      const listPets = bundle.collections[0].requests.find((r) => r.name === "listPets")
      expect(listPets!.description).toBe("List all pets")
    })

    it("throws on invalid input", () => {
      expect(() => importOpenAPI('{"invalid": true}')).toThrow()
    })

    it("throws on non-object input", () => {
      expect(() => importOpenAPI("not-json")).toThrow()
    })
  })
})

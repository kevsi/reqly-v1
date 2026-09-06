import { describe, it, expect } from "vitest";
import { handleGenerateRequestFromDescription } from "../mcp/handlers/requests.js";
import type { CollectionStore } from "../mcp/store.js";

function makeStore(): CollectionStore {
  return {
    getCollection: (id: string) =>
      id === "col-1" ? { id, name: "Test", requests: [] } : undefined,
    addRequest: () => {},
  } as unknown as CollectionStore;
}

describe("generate_request_from_description", () => {
  it("infers method and URL from a plain description", () => {
    const res = handleGenerateRequestFromDescription(makeStore(), {
      description: "GET https://api.example.com/posts?limit=10 latest posts",
    });
    expect(res.isError).toBeUndefined();
    const parsed = JSON.parse((res.content[0] as { text: string }).text);
    expect(parsed.request.method).toBe("GET");
    expect(parsed.request.url).toBe("https://api.example.com/posts?limit=10");
    expect(parsed.saved).toBe(false);
  });

  it("saves into a collection when collection_id is provided", () => {
    const res = handleGenerateRequestFromDescription(makeStore(), {
      description: "POST https://api.example.com/users create a user",
      collection_id: "col-1",
    });
    const parsed = JSON.parse((res.content[0] as { text: string }).text);
    expect(parsed.saved).toBe(true);
    expect(parsed.request.method).toBe("POST");
  });

  it("errors without description", () => {
    const res = handleGenerateRequestFromDescription(makeStore(), {});
    expect(res.isError).toBe(true);
  });

  it("errors on unknown collection", () => {
    const res = handleGenerateRequestFromDescription(makeStore(), {
      description: "GET https://x.dev",
      collection_id: "nope",
    });
    expect(res.isError).toBe(true);
  });
});

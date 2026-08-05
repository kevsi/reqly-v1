import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { CollectionStore } from "../store.js";
import { generateTests } from "../../generate-tests.js";

export function handleGenerateTests(
  store: CollectionStore,
  args: Record<string, unknown>,
): CallToolResult {
  const spec = args.spec as string | undefined;
  const baseUrl = args.base_url as string | undefined;
  const saveCollectionId = args.save_collection_id as string | undefined;

  if (!spec) {
    return {
      content: [{ type: "text", text: "Missing required argument: spec (OpenAPI JSON/YAML)" }],
      isError: true,
    };
  }

  try {
    const bundle = generateTests(spec, baseUrl);
    const collection = bundle.collections[0];

    if (saveCollectionId) {
      const target = store.getCollection(saveCollectionId);
      if (!target) {
        return {
          content: [{ type: "text", text: `Collection not found: ${saveCollectionId}` }],
          isError: true,
        };
      }
      for (const req of collection.requests) {
        store.addRequest(saveCollectionId, req as any);
      }
      return {
        content: [
          {
            type: "text",
            text: `Added ${collection.requests.length} edge-case tests to "${target.name}"`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(bundle, null, 2).slice(0, 100_000),
        },
      ],
    };
  } catch (e) {
    return {
      content: [
        {
          type: "text",
          text: `Failed to generate tests: ${e instanceof Error ? e.message : String(e)}`,
        },
      ],
      isError: true,
    };
  }
}

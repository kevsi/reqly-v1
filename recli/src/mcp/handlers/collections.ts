import type { CollectionStore } from "../store.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function handleListCollections(store: CollectionStore): CallToolResult {
  const collections = store.getCollections().map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    request_count: c.requests.length,
    folder_count: c.folders?.length ?? 0,
    color: c.color,
    icon: c.icon,
  }));
  return { content: [{ type: "text", text: JSON.stringify(collections, null, 2) }] };
}

export function handleCreateCollection(
  store: CollectionStore,
  args: Record<string, unknown>,
): CallToolResult {
  const colName = String(args.name ?? "");
  if (!colName) {
    return { content: [{ type: "text", text: "Missing required field: name" }], isError: true };
  }
  const color = String(args.color ?? "blue");
  const icon = String(args.icon ?? "folder");
  const description = args.description ? String(args.description) : undefined;
  const collection = store.addCollection(colName, description, color, icon);
  return {
    content: [{ type: "text", text: JSON.stringify({ created: true, collection_id: collection.id, name: collection.name }, null, 2) }],
  };
}

export function handleUpdateCollection(
  store: CollectionStore,
  args: Record<string, unknown>,
): CallToolResult {
  const colId = String(args.collection_id ?? "");
  const col = store.getCollection(colId);
  if (!col) {
    return { content: [{ type: "text", text: `Collection not found: ${colId}` }], isError: true };
  }
  if (args.name !== undefined) col.name = String(args.name);
  if (args.description !== undefined) col.description = String(args.description);
  if (args.color !== undefined) col.color = String(args.color);
  if (args.icon !== undefined) col.icon = String(args.icon);
  store.updateCollection(colId, { name: col.name, description: col.description });
  return { content: [{ type: "text", text: JSON.stringify({ updated: true, collection_id: colId }), },], };
}

export function handleDeleteCollection(
  store: CollectionStore,
  args: Record<string, unknown>,
): CallToolResult {
  const colId = String(args.collection_id ?? "");
  const col = store.getCollection(colId);
  if (!col) {
    return { content: [{ type: "text", text: `Collection not found: ${colId}` }], isError: true };
  }
  store.deleteCollection(colId);
  return { content: [{ type: "text", text: JSON.stringify({ deleted: true, collection_id: colId }) }] };
}

export function handleDuplicateCollection(
  store: CollectionStore,
  args: Record<string, unknown>,
): CallToolResult {
  const colId = String(args.collection_id ?? "");
  const col = store.getCollection(colId);
  if (!col) {
    return { content: [{ type: "text", text: `Collection not found: ${colId}` }], isError: true };
  }
  const newCol = store.duplicateCollection(colId);
  return {
    content: [{ type: "text", text: JSON.stringify({ duplicated: true, new_collection_id: newCol?.id, name: newCol?.name }, null, 2) }],
  };
}

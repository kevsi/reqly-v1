import type { CollectionStore } from "../store.js";
import { parseCurlCommand, generateCurlCommand } from "../curl-parser.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { RequestItem } from "../types.js";

export function handleListRequests(
  store: CollectionStore,
  args: Record<string, unknown>,
): CallToolResult {
  const collectionId = String(args.collection_id ?? "");
  const collection = store.getCollection(collectionId);
  if (!collection) {
    return {
      content: [{ type: "text", text: `Collection not found: ${collectionId}` }],
      isError: true,
    };
  }
  const requests = collection.requests.map((r) => ({
    id: r.id,
    name: r.name,
    method: r.method,
    url: r.url,
    endpoint: r.endpoint,
    folder_id: r.folderId ?? null,
  }));
  return { content: [{ type: "text", text: JSON.stringify(requests, null, 2) }] };
}

export function handleGetCollectionTree(
  store: CollectionStore,
  args: Record<string, unknown>,
): CallToolResult {
  const treeColId = String(args.collection_id ?? "");
  const treeCollection = store.getCollection(treeColId);
  if (!treeCollection) {
    return {
      content: [{ type: "text", text: `Collection not found: ${treeColId}` }],
      isError: true,
    };
  }
  const folders = treeCollection.folders ?? [];
  const rootRequests = treeCollection.requests.filter((r) => !r.folderId);
  const tree = {
    id: treeCollection.id,
    name: treeCollection.name,
    root_requests: rootRequests.map((r) => ({
      id: r.id,
      name: r.name,
      method: r.method,
      url: r.url,
    })),
    folders: folders.map((f) => ({
      id: f.id,
      name: f.name,
      parent_id: f.parentId,
      requests: treeCollection.requests
        .filter((r) => r.folderId === f.id)
        .map((r) => ({ id: r.id, name: r.name, method: r.method, url: r.url })),
    })),
  };
  return { content: [{ type: "text", text: JSON.stringify(tree, null, 2) }] };
}

export function handleGetRequest(
  store: CollectionStore,
  args: Record<string, unknown>,
): CallToolResult {
  const requestId = String(args.request_id ?? "");
  const found = store.findRequestById(requestId);
  if (!found) {
    return { content: [{ type: "text", text: `Request not found: ${requestId}` }], isError: true };
  }
  const { request } = found;
  const detail = {
    id: request.id,
    name: request.name,
    method: request.method,
    url: request.url,
    endpoint: request.endpoint,
    headers: request.headers ?? {},
    body: request.body ?? null,
    body_type: request.bodyType ?? null,
    auth_type: request.authType ?? "none",
    auth_token: request.authToken ? "***" : null,
    query_params: request.queryParams ?? [],
    folder_id: request.folderId ?? null,
    created_at: request.createdAt,
    updated_at: request.updatedAt,
  };
  return { content: [{ type: "text", text: JSON.stringify(detail, null, 2) }] };
}

export function handleCreateRequest(
  store: CollectionStore,
  args: Record<string, unknown>,
): CallToolResult {
  const colId = String(args.collection_id ?? "");
  const name = String(args.name ?? "");
  const method = String(args.method ?? "GET");
  const url = String(args.url ?? "");
  if (!colId || !name || !method || !url) {
    return {
      content: [
        { type: "text", text: "Missing required fields: collection_id, name, method, url" },
      ],
      isError: true,
    };
  }
  const collection = store.getCollection(colId);
  if (!collection) {
    return { content: [{ type: "text", text: `Collection not found: ${colId}` }], isError: true };
  }
  const now = Date.now();
  const queryParams = Array.isArray(args.query_params)
    ? (args.query_params as Array<{ key: string; value: string }>)
    : undefined;
  const requestItem: RequestItem = {
    id: `req-${now}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    method: method as RequestItem["method"],
    url,
    endpoint: url,
    headers: (args.headers as Record<string, string> | undefined) ?? {},
    body: args.body !== undefined ? String(args.body) : undefined,
    bodyType: (args.body_type as RequestItem["bodyType"]) ?? undefined,
    authType: (args.auth_type as RequestItem["authType"]) ?? "none",
    authToken: args.auth_token !== undefined ? String(args.auth_token) : undefined,
    queryParams,
    createdAt: now,
    updatedAt: now,
  };
  store.addRequest(colId, requestItem);
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          { created: true, request_id: requestItem.id, name, method, url },
          null,
          2,
        ),
      },
    ],
  };
}

export function handleUpdateRequest(
  store: CollectionStore,
  args: Record<string, unknown>,
): CallToolResult {
  const reqId = String(args.request_id ?? "");
  const found = store.findRequestById(reqId);
  if (!found) {
    return { content: [{ type: "text", text: `Request not found: ${reqId}` }], isError: true };
  }
  const updates: Partial<RequestItem> = {};
  if (args.name !== undefined) updates.name = String(args.name);
  if (args.method !== undefined) updates.method = String(args.method) as RequestItem["method"];
  if (args.url !== undefined) updates.url = String(args.url);
  if (args.headers !== undefined) updates.headers = args.headers as Record<string, string>;
  if (args.body !== undefined) updates.body = String(args.body);
  if (args.body_type !== undefined) updates.bodyType = args.body_type as RequestItem["bodyType"];
  if (args.auth_type !== undefined) updates.authType = args.auth_type as RequestItem["authType"];
  if (args.auth_token !== undefined) updates.authToken = String(args.auth_token);
  if (args.query_params !== undefined)
    updates.queryParams = args.query_params as Array<{ key: string; value: string }>;
  if (args.folder_id !== undefined)
    updates.folderId = args.folder_id === null ? null : String(args.folder_id);
  store.updateRequest(reqId, updates);
  return {
    content: [
      { type: "text", text: JSON.stringify({ updated: true, request_id: reqId }, null, 2) },
    ],
  };
}

export function handleDeleteRequest(
  store: CollectionStore,
  args: Record<string, unknown>,
): CallToolResult {
  const reqId = String(args.request_id ?? "");
  const found = store.findRequestById(reqId);
  if (!found) {
    return { content: [{ type: "text", text: `Request not found: ${reqId}` }], isError: true };
  }
  store.deleteRequest(reqId);
  return {
    content: [{ type: "text", text: JSON.stringify({ deleted: true, request_id: reqId }) }],
  };
}

export function handleDuplicateRequest(
  store: CollectionStore,
  args: Record<string, unknown>,
): CallToolResult {
  const reqId = String(args.request_id ?? "");
  const targetColId = args.target_collection_id ? String(args.target_collection_id) : undefined;
  const found = store.findRequestById(reqId);
  if (!found) {
    return { content: [{ type: "text", text: `Request not found: ${reqId}` }], isError: true };
  }
  const newReq = store.duplicateRequest(reqId, targetColId);
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ duplicated: true, new_request_id: newReq?.id }, null, 2),
      },
    ],
  };
}

export function handleImportFromCurl(
  store: CollectionStore,
  args: Record<string, unknown>,
): CallToolResult {
  const colId = String(args.collection_id ?? "");
  const curlCommand = String(args.curl_command ?? "");
  const reqName = args.name ? String(args.name) : undefined;
  if (!colId || !curlCommand) {
    return {
      content: [{ type: "text", text: "Missing required fields: collection_id, curl_command" }],
      isError: true,
    };
  }
  const collection = store.getCollection(colId);
  if (!collection) {
    return { content: [{ type: "text", text: `Collection not found: ${colId}` }], isError: true };
  }
  const parsed = parseCurlCommand(curlCommand);
  if (!parsed) {
    return { content: [{ type: "text", text: "Failed to parse curl command" }], isError: true };
  }
  const now = Date.now();
  const requestItem: RequestItem = {
    id: `req-${now}-${Math.random().toString(36).slice(2, 8)}`,
    name: reqName || `${parsed.method} ${parsed.url}`,
    method: parsed.method as RequestItem["method"],
    url: parsed.url,
    endpoint: parsed.url,
    headers: parsed.headers ?? {},
    body: parsed.body,
    createdAt: now,
    updatedAt: now,
  };
  store.addRequest(colId, requestItem);
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          { created: true, request_id: requestItem.id, method: parsed.method, url: parsed.url },
          null,
          2,
        ),
      },
    ],
  };
}

export function handleExportRequestToCurl(
  store: CollectionStore,
  args: Record<string, unknown>,
): CallToolResult {
  const reqId = String(args.request_id ?? "");
  const found = store.findRequestById(reqId);
  if (!found) {
    return { content: [{ type: "text", text: `Request not found: ${reqId}` }], isError: true };
  }
  const curl = generateCurlCommand(found.request);
  return { content: [{ type: "text", text: curl }] };
}

export function handleSearchRequests(
  store: CollectionStore,
  args: Record<string, unknown>,
): CallToolResult {
  const query = String(args.query ?? "").toLowerCase();
  if (!query) {
    return { content: [{ type: "text", text: "Missing required field: query" }], isError: true };
  }
  const results: Array<{
    id: string;
    name: string;
    method: string;
    url: string;
    collection_id: string;
    collection_name: string;
  }> = [];
  for (const col of store.getCollections()) {
    for (const req of col.requests) {
      if (
        req.name.toLowerCase().includes(query) ||
        req.url.toLowerCase().includes(query) ||
        req.method.toLowerCase().includes(query)
      ) {
        results.push({
          id: req.id,
          name: req.name,
          method: req.method,
          url: req.url,
          collection_id: col.id,
          collection_name: col.name,
        });
      }
    }
  }
  return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
}

export function handleMoveRequest(
  store: CollectionStore,
  args: Record<string, unknown>,
): CallToolResult {
  const reqId = String(args.request_id ?? "");
  const targetColId = String(args.target_collection_id ?? "");
  const targetFolderId =
    args.target_folder_id !== undefined
      ? args.target_folder_id === null
        ? null
        : String(args.target_folder_id)
      : undefined;
  if (!reqId || !targetColId) {
    return {
      content: [
        { type: "text", text: "Missing required fields: request_id, target_collection_id" },
      ],
      isError: true,
    };
  }
  store.moveRequest(reqId, targetColId, targetFolderId ?? undefined);
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ moved: true, request_id: reqId, target_collection_id: targetColId }),
      },
    ],
  };
}

export function handleReorderRequests(
  store: CollectionStore,
  args: Record<string, unknown>,
): CallToolResult {
  const colId = String(args.collection_id ?? "");
  const orderedIds = args.ordered_request_ids as string[] | undefined;
  if (!colId || !Array.isArray(orderedIds)) {
    return {
      content: [
        { type: "text", text: "Missing required fields: collection_id, ordered_request_ids" },
      ],
      isError: true,
    };
  }
  store.reorderRequests(colId, orderedIds);
  return {
    content: [{ type: "text", text: JSON.stringify({ reordered: true, collection_id: colId }) }],
  };
}

export function handleValidateRequest(
  _store: CollectionStore,
  args: Record<string, unknown>,
): CallToolResult {
  const issues: string[] = [];
  if (args.request_id) {
    const requestId = String(args.request_id);
    if (requestId && !_store.findRequestById(requestId)) {
      issues.push(`Request not found: ${requestId}`);
    }
  }
  const method = args.method ? String(args.method).toUpperCase() : undefined;
  if (
    method &&
    !["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "GRAPHQL"].includes(method)
  ) {
    issues.push(`Invalid HTTP method: ${method}`);
  }
  const url = args.url ? String(args.url) : undefined;
  if (
    url &&
    !url.startsWith("http://") &&
    !url.startsWith("https://") &&
    !url.startsWith("ws://") &&
    !url.startsWith("wss://")
  ) {
    issues.push(`URL must start with http:// or https://: ${url}`);
  }
  if (issues.length === 0) issues.push("Request is valid");
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          { valid: issues.length === 1 && issues[0] === "Request is valid", issues },
          null,
          2,
        ),
      },
    ],
  };
}

export function handleCreateFolder(
  store: CollectionStore,
  args: Record<string, unknown>,
): CallToolResult {
  const colId = String(args.collection_id ?? "");
  const name = String(args.name ?? "");
  if (!colId || !name) {
    return {
      content: [{ type: "text", text: "Missing required fields: collection_id, name" }],
      isError: true,
    };
  }
  const collection = store.getCollection(colId);
  if (!collection) {
    return { content: [{ type: "text", text: `Collection not found: ${colId}` }], isError: true };
  }
  const parentId = args.parent_id ? String(args.parent_id) : undefined;
  const folderId = store.addFolder(colId, name, parentId);
  return {
    content: [
      { type: "text", text: JSON.stringify({ created: true, folder_id: folderId, name }, null, 2) },
    ],
  };
}

export function handleUpdateFolder(
  store: CollectionStore,
  args: Record<string, unknown>,
): CallToolResult {
  const folderId = String(args.folder_id ?? "");
  const name = args.name ? String(args.name) : undefined;
  const parentId =
    args.parent_id !== undefined
      ? args.parent_id === null
        ? null
        : String(args.parent_id)
      : undefined;
  if (!folderId) {
    return {
      content: [{ type: "text", text: "Missing required field: folder_id" }],
      isError: true,
    };
  }
  store.updateFolder(folderId, { name, parentId: parentId ?? undefined });
  return {
    content: [
      { type: "text", text: JSON.stringify({ updated: true, folder_id: folderId }, null, 2) },
    ],
  };
}

export function handleDeleteFolder(
  store: CollectionStore,
  args: Record<string, unknown>,
): CallToolResult {
  const folderId = String(args.folder_id ?? "");
  if (!folderId) {
    return {
      content: [{ type: "text", text: "Missing required field: folder_id" }],
      isError: true,
    };
  }
  store.deleteFolder(folderId);
  return {
    content: [{ type: "text", text: JSON.stringify({ deleted: true, folder_id: folderId }) }],
  };
}
